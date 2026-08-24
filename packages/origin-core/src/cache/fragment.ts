import type { CachePolicy, Ctx } from "@originloom/shared/lib/types";

import { config } from "../config.js";
import { logError } from "../logger.js";
import {
  observeFragmentAccess,
  observeFragmentFallback,
  observeFragmentRefresh,
} from "../metrics.js";
import { type FragmentDefinition, getRuntime } from "../runtime.js";
import { withRequestSignal } from "../ssr/context.js";
import { coalesceColdMiss } from "./cold-fill.js";
import {
  materializeCachedHtmlDynamicValues,
  normalizeCachedHtmlDynamicValues,
} from "./dynamic-html.js";
import * as cache from "./index.js";
import { normalizeDependencyTags } from "./tags.js";

type FragmentShellProvider = () => Promise<unknown>;

export type FragmentResolutionProviders = {
  /** Shared by every foreground fragment in one document composition. */
  getShell: FragmentShellProvider;
  /** Cold-fill shell; cached documents may detach it from the response request. */
  getFillShell?: FragmentShellProvider;
  /** Detached from the response request and shared by background refreshes. */
  getRefreshShell?: FragmentShellProvider;
};

const fragmentRevalidations = new Map<string, Promise<void>>();

function fragmentDefinition(name: string): FragmentDefinition | undefined {
  return getRuntime().fragments[name];
}

export function fragmentRequiresShell(name: string): boolean {
  return fragmentDefinition(name)?.requiresShell ?? false;
}

export function shouldResolveFragment(name: string, cachedDocument: boolean): boolean {
  const definition = fragmentDefinition(name);
  return definition ? cachedDocument || definition.resolveOnFreshDocument : true;
}

export function fragmentCacheKey(name: string, shell: unknown, ctx: Ctx): string {
  const definition = requiredDefinition(name);
  return validateFragmentKey(
    name,
    definition.keyFromRequest ? definition.keyFromRequest(ctx) : definition.key(shell, ctx),
  );
}

/**
 * Resolves one independently cached HTML fragment. Cold fills are coalesced by
 * the shared cache layer; stale values return immediately and schedule one
 * process-local/distributed refresh.
 */
export async function resolveFragmentByName(
  name: string,
  ctx: Ctx,
  providers: FragmentResolutionProviders,
): Promise<string> {
  const definition = requiredDefinition(name);
  const budgetMs = timeoutMs(definition);
  const deadline = Date.now() + budgetMs;
  const key = await resolveFragmentKey(
    name,
    definition,
    ctx,
    providers.getShell,
    remainingBudget(deadline),
  );
  const policy = fragmentPolicy(definition, key, ctx);
  const cached = await cache.read(key);

  if (cached?.state === "fresh") {
    observeFragmentAccess(name, "fresh");
    return materializeCachedHtmlDynamicValues(cached.body, ctx);
  }
  if (cached?.state === "stale" && (definition.swr ?? 0) > 0) {
    observeFragmentAccess(name, "stale");
    scheduleFragmentRefresh(
      name,
      key,
      definition,
      ctx,
      providers.getRefreshShell ?? providers.getShell,
    );
    return materializeCachedHtmlDynamicValues(cached.body, ctx);
  }
  if (cached) await cache.deleteKey(key);

  const pending = coalesceColdMiss({
    key,
    policy,
    work: async () => {
      const body = await renderFragment(
        name,
        definition,
        ctx,
        definition.keyFromRequest
          ? (providers.getFillShell ?? providers.getShell)
          : providers.getShell,
      );
      return { value: body, body, cacheable: true, terminal: false };
    },
    isTimeout: (error) => error instanceof FragmentTimeoutError,
    memory: { namespace: "fragment" },
  });
  const result = await waitForFragmentResult(
    pending,
    ctx.request.signal,
    name,
    remainingBudget(deadline),
  );
  observeFragmentAccess(
    name,
    result.kind === "cache" && result.state === "STALE" ? "stale" : "miss",
  );
  if (result.kind === "cache" && result.state === "STALE") {
    scheduleFragmentRefresh(
      name,
      key,
      definition,
      ctx,
      providers.getRefreshShell ?? providers.getShell,
    );
  }
  const html = result.kind === "cache" ? result.body : result.work.value;
  return materializeCachedHtmlDynamicValues(html, ctx);
}

/** Compatibility helper for product code that already has a resolved shell. */
export function getOrSetFragmentByName(name: string, shell: unknown, ctx: Ctx): Promise<string> {
  const getShell = async () => shell;
  return resolveFragmentByName(name, ctx, { getShell, getRefreshShell: getShell });
}

/** Renders an explicit uncached fallback; undefined means preserve marker HTML. */
export async function fragmentFallbackByName(
  name: string,
  error: unknown,
  ctx: Ctx,
): Promise<string | undefined> {
  const definition = fragmentDefinition(name);
  const reason = error instanceof FragmentTimeoutError ? "timeout" : "error";
  observeFragmentFallback(name, reason);
  if (!definition?.fallback) return undefined;
  const node = await definition.fallback({ error, reason, ctx });
  const html = getRuntime().renderer.renderNode(node);
  return materializeCachedHtmlDynamicValues(normalizeCachedHtmlDynamicValues(html, ctx), ctx);
}

export async function drainFragmentRevalidations(timeoutMs: number): Promise<boolean> {
  const pending = [...fragmentRevalidations.values()];
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

async function resolveFragmentKey(
  name: string,
  definition: FragmentDefinition,
  ctx: Ctx,
  getShell: FragmentShellProvider,
  budgetMs: number,
): Promise<string> {
  if (definition.keyFromRequest) {
    return validateFragmentKey(name, definition.keyFromRequest(ctx));
  }
  const shell = definition.requiresShell
    ? await waitForFragmentResult(getShell(), ctx.request.signal, name, budgetMs)
    : null;
  return validateFragmentKey(name, definition.key(shell, ctx));
}

function scheduleFragmentRefresh(
  name: string,
  key: string,
  definition: FragmentDefinition,
  ctx: Ctx,
  getShell: FragmentShellProvider,
): void {
  if (fragmentRevalidations.has(key)) return;
  const pending = runFragmentRefresh(name, key, definition, ctx, getShell)
    .catch((error: unknown) => {
      logError(error, {
        msg: "fragment background refresh failed",
        fragment: name,
        path: ctx.url.pathname,
      });
    })
    .finally(() => {
      if (fragmentRevalidations.get(key) === pending) fragmentRevalidations.delete(key);
    });
  fragmentRevalidations.set(key, pending);
}

async function runFragmentRefresh(
  name: string,
  key: string,
  definition: FragmentDefinition,
  ctx: Ctx,
  getShell: FragmentShellProvider,
): Promise<void> {
  const started = performance.now();
  let outcome: "success" | "error" | "timeout" | "lock_miss" | "race_hit" = "error";
  let lockToken: string | undefined;
  try {
    if (cache.isL2Configured()) {
      const lock = await cache.acquireCoordinationLock(
        `fragment-refresh:${key}`,
        timeoutMs(definition) + 1_000,
      );
      if (lock.kind === "held") {
        outcome = "lock_miss";
        return;
      }
      if (lock.kind === "acquired") {
        lockToken = lock.token;
        const raced = await cache.read(key);
        if (raced?.state === "fresh") {
          outcome = "race_hit";
          return;
        }
      }
    }

    const body = await renderFragment(name, definition, ctx, getShell);
    if (
      !(await cache.write(key, body, fragmentPolicy(definition, key, ctx), {
        namespace: "fragment",
      }))
    ) {
      throw new Error(`Fragment cache write failed: ${name}`);
    }
    outcome = "success";
  } catch (error) {
    outcome = error instanceof FragmentTimeoutError ? "timeout" : "error";
    throw error;
  } finally {
    if (lockToken) {
      await cache.releaseCoordinationLock(`fragment-refresh:${key}`, lockToken);
    }
    observeFragmentRefresh(name, outcome, performance.now() - started);
  }
}

async function renderFragment(
  name: string,
  definition: FragmentDefinition,
  ctx: Ctx,
  getShell: FragmentShellProvider,
): Promise<string> {
  const timeout = timeoutMs(definition);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new FragmentTimeoutError(name, timeout)),
    timeout,
  );
  timer.unref?.();
  const workCtx: Ctx = {
    ...ctx,
    request: withRequestSignal(ctx.request, controller.signal),
  };
  const pending = (async () => {
    const shell = definition.requiresShell
      ? await waitForSignal(getShell(), controller.signal)
      : null;
    if (controller.signal.aborted) throw abortReason(controller.signal);
    const node = await definition.resolve(shell, workCtx);
    const html = getRuntime().renderer.renderNode(node);
    return normalizeCachedHtmlDynamicValues(html, workCtx);
  })();
  try {
    return await waitForSignal(pending, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function fragmentPolicy(
  definition: FragmentDefinition,
  key: string,
  ctx: Ctx,
): CachePolicy & { kind: "shared" } {
  const tags = normalizeDependencyTags(
    typeof definition.tags === "function" ? definition.tags(ctx) : definition.tags,
  );
  return {
    kind: "shared",
    ttl: definition.ttl,
    ...((definition.swr ?? 0) > 0 ? { swr: definition.swr } : {}),
    ...(tags.length ? { tags } : {}),
    key: [key],
  };
}

function requiredDefinition(name: string): FragmentDefinition {
  const definition = fragmentDefinition(name);
  if (!definition) throw new Error(`Bilinmeyen fragment resolver: ${name}`);
  return definition;
}

function validateFragmentKey(name: string, key: string): string {
  if (!key || key.length > 2_048) throw new Error(`Invalid fragment cache key: ${name}`);
  return key;
}

function timeoutMs(definition: FragmentDefinition): number {
  return definition.timeoutMs ?? config.fragmentTimeoutMs;
}

function remainingBudget(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function waitForFragmentResult<T>(
  pending: Promise<T>,
  requestSignal: AbortSignal,
  name: string,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) {
    void pending.catch(() => undefined);
    return Promise.reject(new FragmentTimeoutError(name, timeoutMs));
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new FragmentTimeoutError(name, timeoutMs)),
    timeoutMs,
  );
  timer.unref?.();
  const signal = AbortSignal.any([requestSignal, controller.signal]);
  return waitForSignal(pending, signal).finally(() => clearTimeout(timer));
}

function waitForSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

export class FragmentTimeoutError extends Error {
  readonly fragment: string;
  readonly timeoutMs: number;

  constructor(fragment: string, timeoutMs: number) {
    super(`Fragment ${fragment} exceeded its ${timeoutMs}ms timeout`);
    this.name = "FragmentTimeoutError";
    this.fragment = fragment;
    this.timeoutMs = timeoutMs;
  }
}
