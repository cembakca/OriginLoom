import type { Span } from "@opentelemetry/api";
import type { CachePolicy } from "@originloom/shared/lib/types";

import { config } from "../config.js";
import { logError, logger } from "../logger.js";
import {
  observeCacheEntryWrite,
  observeCacheFastPathRead,
  observeCacheOperation,
  setCacheL2Health,
} from "../metrics.js";
import { SpanKind, withSpan } from "../observability.js";
import { applyInvalidationToL1, CacheInvalidationBus } from "./invalidation.js";
import { formatCacheKey } from "./key-codec.js";
import type { CacheMemoryWriteOptions, CacheNamespace } from "./l1-policy.js";
import { MemoryStore } from "./memory.js";
import { RedisStore } from "./redis.js";
import { MAX_TAG_KEYS, normalizeTagOperation } from "./tags.js";
import { TieredStore } from "./tiered.js";
import type { CacheStore } from "./types.js";
import type { CacheReadResult } from "./types.js";
import type { RateLimitResult } from "./types.js";
import type { TagInvalidationResult } from "./types.js";

let store: CacheStore | null = null;
let invalidationBus: CacheInvalidationBus | null = null;

function runtimeCacheBackend(): "memory" | "redis" {
  const value = process.env.CACHE_BACKEND ?? config.cacheBackend;
  return value === "redis" ? "redis" : "memory";
}

function runtimeRedisUrl(): string | undefined {
  const value = process.env.REDIS_URL ?? config.redisUrl;
  return value?.trim() ? value : undefined;
}

export type CacheTopology = "memory" | "memory+redis";

/**
 * `process.env` is a native accessor, not a plain object: each property read
 * costs roughly 200ns against ~10ns for an ordinary property. `cacheTopology()`
 * used to perform two of them on *every* call, and it is called once per
 * `read()` (including the L1 fast path below) and once per `runCacheOperation`.
 * On a warm page-cache hit that resolves three fragments that was ~8 env reads
 * — measurably more than the L1 map lookup those reads were annotating.
 *
 * The topology can only change when the cache is (re)built, so it is resolved
 * once and invalidated by `initCache()`/`closeCache()`. Tests that switch
 * `CACHE_BACKEND` already bracket the change with `closeCache()` + `initCache()`,
 * which is also the only sequence that is meaningful at runtime — a store that
 * is already open does not migrate backends when an env var is reassigned.
 */
let topologyMemo: { topology: CacheTopology; l2: boolean } | null = null;

function resolveTopology(): { topology: CacheTopology; l2: boolean } {
  if (topologyMemo) return topologyMemo;
  const l2 = runtimeCacheBackend() === "redis" && Boolean(runtimeRedisUrl());
  topologyMemo = { topology: l2 ? "memory+redis" : "memory", l2 };
  return topologyMemo;
}

/** Drops the memo so the next read re-derives it from the current environment. */
function invalidateTopologyMemo(): void {
  topologyMemo = null;
}

export function cacheTopology(): CacheTopology {
  return resolveTopology().topology;
}

export function isL2Configured(): boolean {
  return resolveTopology().l2;
}

export async function initCache(): Promise<CacheStore> {
  if (store) return store;
  invalidateTopologyMemo();

  const l1 = new MemoryStore(config.cacheMaxEntries, {
    maxBytes: config.cacheL1MaxBytes,
    namespaces: config.cacheL1Namespaces,
    auxiliary: config.cacheL1Auxiliary,
  });
  let l2: RedisStore | null = null;
  let invalidation: CacheInvalidationBus | undefined;
  const backend = runtimeCacheBackend();
  const redisUrl = runtimeRedisUrl();

  if (backend === "redis") {
    if (!redisUrl) {
      if (config.cacheRequired) {
        throw new Error("REDIS_URL is required when CACHE_BACKEND=redis");
      }
      logger.warn("CACHE_BACKEND=redis without REDIS_URL; continuing with L1-only cache");
    } else {
      l2 = new RedisStore(redisUrl, config.releaseId);
      try {
        await l2.ping();
      } catch (error) {
        if (config.cacheRequired) throw error;
        logError(error, {
          msg: "redis unavailable at startup; continuing with L1-only cache until reconnect",
        });
      }

      invalidation = new CacheInvalidationBus(l2.getClient(), config.releaseId, (message) =>
        applyInvalidationToL1(l1, message),
      );
      try {
        await invalidation.startSubscriber(() => l2!.duplicateClient());
        invalidationBus = invalidation;
      } catch (error) {
        if (config.cacheRequired) throw error;
        logError(error, {
          msg: "cache invalidation subscriber failed; cross-pod L1 sync disabled until reconnect",
        });
        invalidation = undefined;
      }
    }
  }

  store = new TieredStore({ l1, l2, ...(invalidation ? { invalidation } : {}) });
  logger.info("cache initialized", { topology: cacheTopology() });
  return store;
}

export function getCache(): CacheStore {
  if (!store) throw new Error("Cache not initialized — call initCache() first");
  return store;
}

export function isCacheInitialized(): boolean {
  return store !== null;
}

export async function closeCache(): Promise<void> {
  invalidateTopologyMemo();
  await invalidationBus?.close();
  invalidationBus = null;
  await store?.close?.();
  store = null;
}

export function cacheKey(policy: CachePolicy): string | null {
  return policy.kind === "shared" ? formatCacheKey(policy.key) : null;
}

export async function read(key: string): Promise<CacheReadResult | null> {
  try {
    const fast = tryFastRead(key);
    if (fast) return fast;
    return await runCacheOperation("read", async (span) => {
      const result = await getCache().read(key);
      span.setAttribute("cache.result", result?.state ?? "miss");
      return result;
    });
  } catch (error) {
    logError(error, { msg: "cache read failed", key });
    return null;
  }
}

/**
 * Untraced fast path for a warm, fresh L1 hit — every cache consumer (route
 * cache, resource cache, and any future fragment/API cache) goes through
 * `read()` above, so this one branch is the single leveraged place to remove
 * span + histogram overhead from the dominant case at steady state.
 *
 * Returns null for anything it cannot resolve on its own — no L1 entry, an
 * L1 entry that is merely stale, or a store with no `readSync` support — and
 * the caller falls straight through to the unmodified, fully-traced path
 * below. Semantics for every outcome other than "L1 fresh hit" are therefore
 * byte-for-byte unchanged: miss, stale, L2-only, refresh and error all still
 * run through `runCacheOperation` exactly as before.
 *
 * Telemetry is deliberately *not* silently dropped here. The fast path still
 * increments `ssr_cache_operations_total{operation="read"}` with the same
 * label a traced successful read produces, so that counter stays a true count
 * of reads rather than collapsing to near-zero the moment the cache goes warm.
 * What the fast path does skip is the span and the duration histogram — so
 * `ssr_cache_operation_duration_*{operation="read"}` now describes only
 * misses, stale hits and L2 reads. That is a deliberate narrowing (a sub-
 * microsecond map lookup is not what a latency dashboard is watching for), but
 * it *is* a change in what the histogram means: its p50 will step up when this
 * ships, because the cheapest population left it. `ssr_cache_fast_path_reads_total`
 * is the numerator for "what fraction of reads bypassed tracing".
 */
function tryFastRead(key: string): CacheReadResult | null {
  const cache = getCache();
  if (!cache.readSync) return null;
  const hit = cache.readSync(key);
  if (!hit || hit.state !== "fresh") return null;
  observeCacheFastPathRead(cacheTopology());
  return hit;
}

export async function write(
  key: string,
  body: string,
  policy: CachePolicy,
  memory?: CacheMemoryWriteOptions,
): Promise<boolean> {
  try {
    const written = await runCacheOperation("write", () =>
      getCache().write(key, body, policy, memory),
    );
    if (written) observeCacheEntryWrite(key, body);
    return written;
  } catch (error) {
    logError(error, { msg: "cache write failed", key });
    return false;
  }
}

export async function attachMemoryValue(
  key: string,
  value: unknown,
  valueBytes: number,
  namespace: CacheNamespace,
): Promise<boolean> {
  try {
    const cache = getCache();
    if (!cache.attachMemoryValue) return false;
    return await runCacheOperation("l1.attach", () =>
      cache.attachMemoryValue!(key, value, valueBytes, namespace),
    );
  } catch (error) {
    logError(error, { msg: "cache L1 typed value attach failed", key });
    return false;
  }
}

export async function deleteKey(key: string): Promise<boolean> {
  return runCacheOperation("delete", () => getCache().deleteKey(key));
}

export async function invalidateTags(tags: readonly string[]): Promise<TagInvalidationResult> {
  const normalized = normalizeTagOperation(tags);
  return runCacheOperation("tag.invalidate", () =>
    getCache().deleteByTags(normalized, MAX_TAG_KEYS),
  );
}

export function cacheControl(policy: CachePolicy): string {
  if (policy.kind === "none") return "private, no-store";
  return "private, no-cache, max-age=0";
}

export async function pingCache(): Promise<boolean> {
  if (!isL2Configured()) return true;
  const cache = getCache();
  try {
    const healthy = cache.ping ? await runCacheOperation("ping", () => cache.ping!()) : true;
    setCacheL2Health(healthy);
    return config.cacheRequired ? healthy : true;
  } catch (error) {
    logger.warn("cache ping failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    setCacheL2Health(false);
    return config.cacheRequired ? false : true;
  }
}

export async function acquireRevalidationLock(key: string): Promise<string | null> {
  const cache = getCache();
  if (!cache.acquireLock) return crypto.randomUUID();
  try {
    const retryDelayMs =
      config.revalidationBackoffMs * (2 ** Math.max(0, config.revalidationAttempts - 1) - 1);
    const ttlMs = config.gatewayTimeoutMs * config.revalidationAttempts + retryDelayMs + 5_000;
    return await runCacheOperation("lock.acquire", () => cache.acquireLock!(key, ttlMs));
  } catch (error) {
    logError(error, { msg: "cache lock failed", key });
    return null;
  }
}

export async function releaseRevalidationLock(key: string, token: string): Promise<void> {
  const cache = getCache();
  if (!cache.releaseLock) return;
  try {
    await runCacheOperation("lock.release", () => cache.releaseLock!(key, token));
  } catch (error) {
    logError(error, { msg: "cache unlock failed", key });
  }
}

export type ColdMissLockAttempt =
  { kind: "acquired"; token: string } | { kind: "held" } | { kind: "unavailable" };

export async function acquireColdMissLock(key: string): Promise<ColdMissLockAttempt> {
  const cache = getCache();
  if (!cache.acquireLock) {
    return { kind: "acquired", token: crypto.randomUUID() };
  }
  try {
    const token = await runCacheOperation("cold_fill_lock.acquire", () =>
      cache.acquireLock!(`cold-fill:${key}`, config.cacheFillTimeoutMs + 1_000),
    );
    return token ? { kind: "acquired", token } : { kind: "held" };
  } catch (error) {
    logError(error, { msg: "cold fill cache lock failed", key });
    return { kind: "unavailable" };
  }
}

export async function releaseColdMissLock(key: string, token: string): Promise<void> {
  const cache = getCache();
  if (!cache.releaseLock) return;
  try {
    await runCacheOperation("cold_fill_lock.release", () =>
      cache.releaseLock!(`cold-fill:${key}`, token),
    );
  } catch (error) {
    logError(error, { msg: "cold fill cache unlock failed", key });
  }
}

export type CoordinationLockAttempt =
  { kind: "acquired"; token: string } | { kind: "held" } | { kind: "unavailable" };

export async function acquireCoordinationLock(
  key: string,
  ttlMs: number,
): Promise<CoordinationLockAttempt> {
  try {
    const cache = getCache();
    if (!cache.acquireLock) return { kind: "unavailable" };
    const token = await runCacheOperation("coordination_lock.acquire", () =>
      cache.acquireLock!(`coordination:${key}`, ttlMs),
    );
    return token ? { kind: "acquired", token } : { kind: "held" };
  } catch (error) {
    logError(error, { msg: "coordination lock failed", key });
    return { kind: "unavailable" };
  }
}

export async function releaseCoordinationLock(key: string, token: string): Promise<void> {
  try {
    const cache = getCache();
    if (!cache.releaseLock) return;
    await runCacheOperation("coordination_lock.release", () =>
      cache.releaseLock!(`coordination:${key}`, token),
    );
  } catch (error) {
    logError(error, { msg: "coordination unlock failed", key });
  }
}

export async function readCoordinationValue(key: string): Promise<string | null> {
  try {
    const cache = getCache();
    if (!cache.readEphemeral) return null;
    return await runCacheOperation("coordination_value.read", () => cache.readEphemeral!(key));
  } catch (error) {
    logError(error, { msg: "coordination value read failed", key });
    return null;
  }
}

export async function writeCoordinationValue(
  key: string,
  value: string,
  ttlMs: number,
): Promise<void> {
  try {
    const cache = getCache();
    if (!cache.writeEphemeral) return;
    await runCacheOperation("coordination_value.write", () =>
      cache.writeEphemeral!(key, value, ttlMs),
    );
  } catch (error) {
    logError(error, { msg: "coordination value write failed", key });
  }
}

export async function takeDistributedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  try {
    const cache = getCache();
    if (!cache.takeRateLimit) return null;
    return await runCacheOperation("rate_limit.take", () =>
      cache.takeRateLimit!(key, limit, windowMs),
    );
  } catch (error) {
    logError(error, { msg: "distributed rate limit failed", key });
    return null;
  }
}

async function runCacheOperation<T>(
  operation: string,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const topology = cacheTopology();
  return withSpan(
    `cache.${operation}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "cache.backend": topology,
        ...(topology === "memory+redis" ? { "db.system.name": "redis" } : {}),
      },
    },
    async (span) => {
      const started = performance.now();
      let outcome: "success" | "error" = "success";
      try {
        return await work(span);
      } catch (error) {
        outcome = "error";
        throw error;
      } finally {
        span.setAttribute("cache.operation", operation);
        span.setAttribute("cache.outcome", outcome);
        observeCacheOperation(topology, operation, outcome, performance.now() - started);
      }
    },
  );
}
