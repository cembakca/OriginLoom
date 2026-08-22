import type { CachePolicy } from "@originloom/shared/lib/types";

import { config } from "../config.js";
import { logError } from "../logger.js";
import {
  buildCachedResourceAccessLabel,
  type CachedResourceAccessResult,
  type CachedResourceAccessState,
  observeCachedResourceAccessPrecomputed,
  observeCachedResourceCoalescing,
  observeCachedResourceDegradation,
  observeCachedResourceRefresh,
} from "../metrics.js";
import * as cache from "./index.js";
import { decodeCachedResource, encodeCachedResource } from "./resource-codec.js";
import { type CachedResourceMemoryEntry, type CachedResourceStoredResult } from "./resource-l1.js";
import { normalizeDependencyTags } from "./tags.js";

export type CachedResourceKeyPart = string | number | boolean | null;

export type CachedResourceLoadResult<T> = CachedResourceStoredResult<T>;

export type CachedResourceResult<T> =
  | { kind: "value"; value: T; cacheState: "fresh" | "stale" | "miss"; staleIfError?: true }
  | { kind: "not-found"; cacheState: "fresh" | "miss" }
  | { kind: "no-content"; cacheState: "fresh" | "miss" };

export type CachedResourceLoadContext = {
  /** Independent of the incoming request; aborted only when this resource's timeout expires. */
  signal: AbortSignal;
  reason: "miss" | "refresh";
};

export type CachedResourceGetOptions = {
  /** Stops only this caller from waiting. Shared fill/refresh work continues safely. */
  signal?: AbortSignal | undefined;
};

export type DefineCachedResourceOptions<T> = {
  namespace: string;
  version: number | string;
  ttl: number;
  swr?: number | undefined;
  staleIfError?: number | undefined;
  negativeTtl?:
    number | { notFound?: number | undefined; noContent?: number | undefined } | undefined;
  timeoutMs?: number | undefined;
  /** Stable dependencies shared by every entry produced by this resource. */
  tags?: readonly string[] | undefined;
  /** Parses and optionally normalizes both loader values and serialized cache values. Throw if invalid. */
  parse: (value: unknown) => T;
  /** Converts a normalized value into JSON-safe data. Defaults to the value itself. */
  serialize?: ((value: T) => unknown) | undefined;
};

export type CachedResource<T> = {
  key(parts: readonly CachedResourceKeyPart[]): string;
  get(
    parts: readonly CachedResourceKeyPart[],
    load: (context: CachedResourceLoadContext) => Promise<CachedResourceLoadResult<T>>,
    options?: CachedResourceGetOptions,
  ): Promise<CachedResourceResult<T>>;
  invalidate(parts: readonly CachedResourceKeyPart[]): Promise<boolean>;
};

/** `accessLabels[state][result]` — every label this resource can ever emit, built once. */
type AccessLabelTable = Record<
  CachedResourceAccessState,
  Record<CachedResourceAccessResult, string>
>;

type ResourceDefinition<T> = {
  namespace: string;
  version: string;
  ttl: number;
  swr: number;
  staleIfError: number;
  negativeTtl: { notFound: number; noContent: number };
  timeoutMs: number;
  tags: readonly string[];
  parse: (value: unknown) => T;
  serialize: (value: T) => unknown;
  accessLabels: AccessLabelTable;
};

const ACCESS_STATES: readonly CachedResourceAccessState[] = ["fresh", "stale", "miss"];
const ACCESS_RESULTS: readonly CachedResourceAccessResult[] = [
  "value",
  "not-found",
  "no-content",
  "error",
];

function buildAccessLabels(namespace: string): AccessLabelTable {
  const table = {} as AccessLabelTable;
  for (const state of ACCESS_STATES) {
    const row = {} as Record<CachedResourceAccessResult, string>;
    for (const result of ACCESS_RESULTS) {
      row[result] = buildCachedResourceAccessLabel(namespace, state, result);
    }
    table[state] = row;
  }
  return table;
}

type ResourcePhase = "fresh" | "swr" | "stale-if-error" | "expired";
type ResourceOperation = "fill" | "refresh";
type OperationResult<T> =
  | { kind: "loaded"; result: CachedResourceStoredResult<T>; entry?: CachedResourceMemoryEntry<T> }
  | { kind: "cache"; entry: CachedResourceMemoryEntry<T> }
  | { kind: "skipped" };

const operationsInFlight = new Map<string, Promise<OperationResult<unknown>>>();
const resourceRevalidations = new Map<string, Promise<void>>();

export function cachedResourceValue<T>(value: T): CachedResourceLoadResult<T> {
  return { kind: "value", value };
}

export function cachedResourceNotFound(): CachedResourceLoadResult<never> {
  return { kind: "not-found" };
}

export function cachedResourceNoContent(): CachedResourceLoadResult<never> {
  return { kind: "no-content" };
}

/**
 * Bounds the per-resource dynamic-key memo below. A resource with a genuinely
 * unbounded key space (e.g. keyed by free-text input) would otherwise grow
 * this map forever; capping it and resetting on overflow trades a rare extra
 * `resourceKey()` recompute for a hard memory ceiling — never a correctness
 * issue, since a memo miss just falls back to computing the key normally.
 */
const MAX_RESOURCE_DYNAMIC_KEY_CACHE_ENTRIES = 512;

export function defineCachedResource<T>(
  options: DefineCachedResourceOptions<T>,
): CachedResource<T> {
  const definition = normalizeDefinition(options);
  const key = createResourceKeyFn(definition);
  return {
    key,
    get: (parts, load, getOptions) =>
      getCachedResource(definition, key(parts), load, getOptions?.signal),
    invalidate: async (parts) => cache.deleteKey(key(parts)),
  };
}

/**
 * `parts: []` is the common case (every "one shared snapshot" page-data
 * resource calls `.get([], ...)`) and is deterministic per resource, so it is
 * computed exactly once, eagerly, at definition time. Non-empty parts are
 * memoized by their JSON shape — cheap to build, and `JSON.stringify`
 * naturally keeps differently-typed-but-same-printed parts distinct (e.g.
 * `["1"]` vs `[1]`) so the memo can never collide two different key spaces.
 * A memo miss always falls back to the exact same `resourceKey()` computation
 * that ran before this change, so this is strictly an optimization: the
 * resulting cache key is byte-for-byte identical either way.
 */
function createResourceKeyFn<T>(
  definition: ResourceDefinition<T>,
): (parts: readonly CachedResourceKeyPart[]) => string {
  const staticKey = resourceKey(definition, []);
  const dynamicKeyCache = new Map<string, string>();
  return (parts: readonly CachedResourceKeyPart[]): string => {
    if (parts.length === 0) return staticKey;
    const memoId = JSON.stringify(parts);
    const cached = dynamicKeyCache.get(memoId);
    if (cached !== undefined) return cached;
    const computed = resourceKey(definition, parts);
    if (dynamicKeyCache.size >= MAX_RESOURCE_DYNAMIC_KEY_CACHE_ENTRIES) dynamicKeyCache.clear();
    dynamicKeyCache.set(memoId, computed);
    return computed;
  };
}

export async function drainCachedResourceRevalidations(timeoutMs: number): Promise<boolean> {
  const pending = [...resourceRevalidations.values()];
  if (pending.length === 0) return true;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = Promise.allSettled(pending).then(() => true);
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
    timeout.unref?.();
  });
  const drained = await Promise.race([completed, deadline]);
  if (timeout) clearTimeout(timeout);
  return drained;
}

async function getCachedResource<T>(
  definition: ResourceDefinition<T>,
  key: string,
  load: (context: CachedResourceLoadContext) => Promise<CachedResourceLoadResult<T>>,
  callerSignal?: AbortSignal,
): Promise<CachedResourceResult<T>> {
  if (callerSignal?.aborted) throw abortReason(callerSignal);

  const cached = await readSerializedResource(definition, key);
  if (cached) {
    const phase = resourcePhase(cached);
    if (phase === "fresh") {
      observeCachedResourceAccessPrecomputed(definition.accessLabels.fresh[cached.result.kind]);
      return publicResult(cached.result, "fresh");
    }
    if (phase === "swr") {
      observeCachedResourceAccessPrecomputed(definition.accessLabels.stale[cached.result.kind]);
      scheduleRefresh(definition, key, cached, load);
      return publicResult(cached.result, "stale");
    }
    if (phase === "stale-if-error") {
      try {
        const operation = startOperation(definition.namespace, key, "refresh", () =>
          runRefresh(definition, key, load, "stale-if-error", cached),
        );
        const refreshed = await waitForSignal(operation.pending, callerSignal);
        if (refreshed.kind !== "skipped") return operationPublicResult(definition, refreshed);
        throw new Error("cached resource refresh lock remained held");
      } catch (error) {
        if (callerSignal?.aborted) throw abortReason(callerSignal);
        if (Date.now() >= cached.staleUntil) throw error;
        observeCachedResourceDegradation(definition.namespace, "stale_if_error");
        observeCachedResourceAccessPrecomputed(definition.accessLabels.stale[cached.result.kind]);
        return publicResult(cached.result, "stale", true);
      }
    }
    await cache.deleteKey(key);
  }

  const operation = startOperation(definition.namespace, key, "fill", () =>
    performCoordinatedLoad(definition, key, load, "miss"),
  );
  let filled: OperationResult<T>;
  try {
    filled = await waitForSignal(operation.pending, callerSignal);
  } catch (error) {
    if (!callerSignal?.aborted) {
      observeCachedResourceAccessPrecomputed(definition.accessLabels.miss.error);
    }
    throw error;
  }
  if (filled.kind === "skipped") throw new Error("cached resource cold fill was skipped");
  return operationPublicResult(definition, filled);
}

function operationPublicResult<T>(
  definition: ResourceDefinition<T>,
  operation: Exclude<OperationResult<T>, { kind: "skipped" }>,
): CachedResourceResult<T> {
  if (operation.kind === "loaded") {
    observeCachedResourceAccessPrecomputed(definition.accessLabels.miss[operation.result.kind]);
    return publicResult(operation.result, "miss");
  }
  const phase = resourcePhase(operation.entry);
  const state = phase === "fresh" ? "fresh" : "stale";
  observeCachedResourceAccessPrecomputed(
    definition.accessLabels[state][operation.entry.result.kind],
  );
  return publicResult(operation.entry.result, state);
}

function scheduleRefresh<T>(
  definition: ResourceDefinition<T>,
  key: string,
  baseline: CachedResourceMemoryEntry<T>,
  load: (context: CachedResourceLoadContext) => Promise<CachedResourceLoadResult<T>>,
): void {
  const operation = startOperation(definition.namespace, key, "refresh", () =>
    runRefresh(definition, key, load, "refresh", baseline),
  );
  if (!operation.started) return;

  const observed = operation.pending
    .then(() => undefined)
    .catch((error: unknown) => {
      logError(error, {
        msg: "cached resource background refresh failed",
        resource: definition.namespace,
      });
    })
    .finally(() => {
      if (resourceRevalidations.get(key) === observed) resourceRevalidations.delete(key);
    });
  resourceRevalidations.set(key, observed);
}

async function runRefresh<T>(
  definition: ResourceDefinition<T>,
  key: string,
  load: (context: CachedResourceLoadContext) => Promise<CachedResourceLoadResult<T>>,
  purpose: "refresh" | "stale-if-error",
  baseline: CachedResourceMemoryEntry<T>,
): Promise<OperationResult<T>> {
  const started = performance.now();
  try {
    const result = await performCoordinatedLoad(definition, key, load, purpose, baseline);
    observeCachedResourceRefresh(
      definition.namespace,
      result.kind === "skipped" ? "lock_miss" : "success",
      performance.now() - started,
    );
    return result;
  } catch (error) {
    observeCachedResourceRefresh(
      definition.namespace,
      error instanceof CachedResourceTimeoutError ? "timeout" : "error",
      performance.now() - started,
    );
    throw error;
  }
}

function startOperation<T>(
  namespace: string,
  key: string,
  operation: ResourceOperation,
  work: () => Promise<OperationResult<T>>,
): { pending: Promise<OperationResult<T>>; started: boolean } {
  const existing = operationsInFlight.get(key) as Promise<OperationResult<T>> | undefined;
  if (existing) {
    observeCachedResourceCoalescing(namespace, operation);
    return { pending: existing, started: false };
  }
  const pending = work().finally(() => {
    if (operationsInFlight.get(key) === pending) operationsInFlight.delete(key);
  });
  operationsInFlight.set(key, pending);
  return { pending, started: true };
}

async function performCoordinatedLoad<T>(
  definition: ResourceDefinition<T>,
  key: string,
  load: (context: CachedResourceLoadContext) => Promise<CachedResourceLoadResult<T>>,
  purpose: "miss" | "refresh" | "stale-if-error",
  baseline?: CachedResourceMemoryEntry<T>,
): Promise<OperationResult<T>> {
  if (!cache.isL2Configured()) return executeAndStore(definition, key, load, purpose);

  const lockKey = `cached-resource:${key}`;
  const lock = await cache.acquireCoordinationLock(lockKey, definition.timeoutMs + 1_000);
  if (lock.kind === "acquired") {
    try {
      const raced = await readSerializedResource(definition, key);
      if (raced && isNewerEntry(raced, baseline)) return { kind: "cache", entry: raced };
      return await executeAndStore(definition, key, load, purpose);
    } finally {
      await cache.releaseCoordinationLock(lockKey, lock.token);
    }
  }
  if (lock.kind === "unavailable") {
    observeCachedResourceDegradation(definition.namespace, "coordination_unavailable");
    return executeAndStore(definition, key, load, purpose);
  }
  if (purpose === "refresh") return { kind: "skipped" };

  const deadline = Date.now() + definition.timeoutMs + 500;
  while (Date.now() < deadline) {
    await delay(Math.min(config.cacheFillPollMs, Math.max(1, deadline - Date.now())));
    const raced = await readSerializedResource(definition, key);
    if (raced && isNewerEntry(raced, baseline)) return { kind: "cache", entry: raced };
  }

  observeCachedResourceDegradation(definition.namespace, "coordination_timeout");
  if (purpose === "stale-if-error") {
    throw new Error("cached resource refresh coordination timed out");
  }
  return executeAndStore(definition, key, load, purpose);
}

async function executeAndStore<T>(
  definition: ResourceDefinition<T>,
  key: string,
  load: (context: CachedResourceLoadContext) => Promise<CachedResourceLoadResult<T>>,
  purpose: "miss" | "refresh" | "stale-if-error",
): Promise<OperationResult<T>> {
  const loaded = await loadWithTimeout(
    load,
    definition.timeoutMs,
    purpose === "miss" ? "miss" : "refresh",
  );
  const normalized = normalizeLoadedResult(definition, loaded);
  const storedAt = Date.now();
  const ttl = resultTtl(definition, normalized);
  if (ttl <= 0) {
    // A negative loader result is still authoritative. When negative caching is
    // disabled, remove an older positive snapshot instead of treating the
    // successful absence like an upstream failure and serving it until expiry.
    if (purpose !== "miss") await cache.deleteKey(key);
    return { kind: "loaded", result: normalized };
  }

  let body: string;
  let canonical: CachedResourceStoredResult<T>;
  try {
    body = encodeCachedResource({
      namespace: definition.namespace,
      version: definition.version,
      storedAt,
      result: normalized,
      serialize: definition.serialize,
    });
    const roundTrip = decodeCachedResource({
      body,
      namespace: definition.namespace,
      version: definition.version,
      parse: definition.parse,
    });
    if (!roundTrip.ok) throw new Error(`resource codec round-trip failed: ${roundTrip.reason}`);
    canonical = roundTrip.result;
  } catch (error) {
    observeCachedResourceDegradation(definition.namespace, "serialization_error");
    logError(error, {
      msg: "cached resource serialization failed",
      resource: definition.namespace,
    });
    return { kind: "loaded", result: normalized };
  }

  const policy = cachePolicy(definition, canonical, key);
  const entry = memoryEntry(definition, body, storedAt, canonical);
  if (
    !(await cache.write(key, body, policy, {
      namespace: canonical.kind === "value" ? "data" : "negative",
      memoryValue: entry,
      memoryValueBytes: estimateTypedValueBytes(body),
    }))
  ) {
    observeCachedResourceDegradation(definition.namespace, "write_error");
    return { kind: "loaded", result: canonical };
  }
  return { kind: "loaded", result: canonical, entry };
}

async function readSerializedResource<T>(
  definition: ResourceDefinition<T>,
  key: string,
): Promise<CachedResourceMemoryEntry<T> | undefined> {
  const hit = await cache.read(key);
  if (!hit) return undefined;
  if (isCachedResourceMemoryEntry<T>(hit.memoryValue, hit.body)) return hit.memoryValue;
  const decoded = decodeCachedResource({
    body: hit.body,
    namespace: definition.namespace,
    version: definition.version,
    parse: definition.parse,
  });
  if (!decoded.ok) {
    observeCachedResourceDegradation(definition.namespace, decoded.reason);
    await cache.deleteKey(key);
    return undefined;
  }
  const entry = memoryEntry(
    definition,
    hit.body,
    Math.min(decoded.storedAt, Date.now()),
    decoded.result,
  );
  if (resourcePhase(entry) === "expired") {
    await cache.deleteKey(key);
    return undefined;
  }
  await cache.attachMemoryValue(
    key,
    entry,
    estimateTypedValueBytes(hit.body),
    decoded.result.kind === "value" ? "data" : "negative",
  );
  return entry;
}

/** A parsed object generally occupies more memory than its compact JSON representation. */
function estimateTypedValueBytes(body: string): number {
  return Math.max(512, Buffer.byteLength(body, "utf8") * 3);
}

function isCachedResourceMemoryEntry<T>(
  value: unknown,
  body: string,
): value is CachedResourceMemoryEntry<T> {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CachedResourceMemoryEntry<T>>;
  return (
    entry.body === body &&
    typeof entry.storedAt === "number" &&
    typeof entry.freshUntil === "number" &&
    typeof entry.swrUntil === "number" &&
    typeof entry.staleUntil === "number" &&
    Boolean(entry.result && typeof entry.result === "object" && "kind" in entry.result)
  );
}

function normalizeLoadedResult<T>(
  definition: ResourceDefinition<T>,
  loaded: CachedResourceLoadResult<T>,
): CachedResourceStoredResult<T> {
  try {
    if (!loaded || typeof loaded !== "object" || !("kind" in loaded)) {
      throw new Error("loader result is not an object");
    }
    if (loaded.kind === "not-found" || loaded.kind === "no-content") {
      return { kind: loaded.kind };
    }
    if (loaded.kind !== "value" || !("value" in loaded)) {
      throw new Error("loader result kind is invalid");
    }
    return { kind: "value", value: definition.parse(loaded.value) };
  } catch (error) {
    throw new CachedResourceValidationError(definition.namespace, { cause: error });
  }
}

function memoryEntry<T>(
  definition: ResourceDefinition<T>,
  body: string,
  storedAt: number,
  result: CachedResourceStoredResult<T>,
): CachedResourceMemoryEntry<T> {
  const ttl = resultTtl(definition, result) * 1_000;
  const freshUntil = storedAt + ttl;
  const value = result.kind === "value";
  const swrUntil = freshUntil + (value ? definition.swr * 1_000 : 0);
  return {
    body,
    result,
    storedAt,
    freshUntil,
    swrUntil,
    staleUntil: swrUntil + (value ? definition.staleIfError * 1_000 : 0),
  };
}

function resourcePhase(entry: CachedResourceMemoryEntry<unknown>): ResourcePhase {
  const now = Date.now();
  if (now < entry.freshUntil) return "fresh";
  if (now < entry.swrUntil) return "swr";
  if (now < entry.staleUntil) return "stale-if-error";
  return "expired";
}

function resultTtl<T>(
  definition: ResourceDefinition<T>,
  result: CachedResourceStoredResult<T>,
): number {
  if (result.kind === "value") return definition.ttl;
  return result.kind === "not-found"
    ? definition.negativeTtl.notFound
    : definition.negativeTtl.noContent;
}

function cachePolicy<T>(
  definition: ResourceDefinition<T>,
  result: CachedResourceStoredResult<T>,
  key: string,
): CachePolicy & { kind: "shared" } {
  const value = result.kind === "value";
  return {
    kind: "shared",
    ttl: resultTtl(definition, result),
    ...(value && definition.swr + definition.staleIfError > 0
      ? { swr: definition.swr + definition.staleIfError }
      : {}),
    ...(definition.tags.length ? { tags: definition.tags } : {}),
    key: [key],
  };
}

function publicResult<T>(
  result: CachedResourceStoredResult<T>,
  cacheState: "fresh" | "stale" | "miss",
  staleIfError = false,
): CachedResourceResult<T> {
  if (result.kind === "value") {
    return {
      kind: "value",
      value: result.value,
      cacheState,
      ...(staleIfError ? { staleIfError: true as const } : {}),
    };
  }
  return { kind: result.kind, cacheState: cacheState === "stale" ? "fresh" : cacheState };
}

function resourceKey<T>(
  definition: ResourceDefinition<T>,
  parts: readonly CachedResourceKeyPart[],
): string {
  const encoded = parts.map(encodeKeyPart);
  const totalLength = encoded.reduce((total, part) => total + part.length, 0);
  if (totalLength > 2_048) throw new Error("Cached resource key exceeds 2048 characters");
  return cache.cacheKey({
    kind: "shared",
    ttl: definition.ttl,
    key: ["resource", definition.namespace, `v:${definition.version}`, ...encoded],
  })!;
}

function encodeKeyPart(part: CachedResourceKeyPart): string {
  if (part === null) return "z:";
  if (typeof part === "string") {
    if (part.length > 512)
      throw new Error("Cached resource string key part exceeds 512 characters");
    return `s:${part}`;
  }
  if (typeof part === "boolean") return part ? "b:1" : "b:0";
  if (!Number.isFinite(part)) throw new Error("Cached resource numeric key parts must be finite");
  return `n:${Object.is(part, -0) ? "0" : String(part)}`;
}

function normalizeDefinition<T>(options: DefineCachedResourceOptions<T>): ResourceDefinition<T> {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(options.namespace)) {
    throw new Error("Cached resource namespace must be a bounded lowercase identifier");
  }
  const version = String(options.version);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)) {
    throw new Error("Cached resource version must be a bounded identifier");
  }
  const negative =
    typeof options.negativeTtl === "number"
      ? { notFound: options.negativeTtl, noContent: options.negativeTtl }
      : {
          notFound: options.negativeTtl?.notFound ?? 0,
          noContent: options.negativeTtl?.noContent ?? 0,
        };
  return {
    namespace: options.namespace,
    version,
    ttl: positiveDuration(options.ttl, "ttl", false),
    swr: positiveDuration(options.swr ?? 0, "swr", true),
    staleIfError: positiveDuration(options.staleIfError ?? 0, "staleIfError", true),
    negativeTtl: {
      notFound: positiveDuration(negative.notFound, "negativeTtl.notFound", true),
      noContent: positiveDuration(negative.noContent, "negativeTtl.noContent", true),
    },
    timeoutMs: positiveDuration(options.timeoutMs ?? config.cacheFillTimeoutMs, "timeoutMs", false),
    tags: normalizeDependencyTags(options.tags),
    parse: options.parse,
    serialize: options.serialize ?? ((value) => value),
    accessLabels: buildAccessLabels(options.namespace),
  };
}

function positiveDuration(value: number, name: string, allowZero: boolean): number {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`Cached resource ${name} must be ${allowZero ? "non-negative" : "positive"}`);
  }
  return value;
}

function isNewerEntry(
  entry: CachedResourceMemoryEntry<unknown>,
  baseline: CachedResourceMemoryEntry<unknown> | undefined,
): boolean {
  return (
    baseline === undefined || entry.storedAt > baseline.storedAt || entry.body !== baseline.body
  );
}

async function loadWithTimeout<T>(
  load: (context: CachedResourceLoadContext) => Promise<CachedResourceLoadResult<T>>,
  timeoutMs: number,
  reason: CachedResourceLoadContext["reason"],
): Promise<CachedResourceLoadResult<T>> {
  const controller = new AbortController();
  const timeoutError = new CachedResourceTimeoutError(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([load({ signal: controller.signal, reason }), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function waitForSignal<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CachedResourceTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Cached resource load exceeded ${timeoutMs}ms`);
    this.name = "CachedResourceTimeoutError";
  }
}

export class CachedResourceValidationError extends Error {
  constructor(namespace: string, options?: ErrorOptions) {
    super(`Cached resource ${namespace} loader returned an invalid value`, options);
    this.name = "CachedResourceValidationError";
  }
}
