import type { Span } from "@opentelemetry/api";
import { config } from "@server/config";
import { logError, logger } from "@server/logger";
import { observeCacheEntryWrite, observeCacheOperation } from "@server/metrics";
import { SpanKind, withSpan } from "@server/observability";

import { formatCacheKey } from "~/lib/cache-keys";
import type { CachePolicy } from "~/lib/types";

import { MemoryStore } from "./memory";
import { RedisStore } from "./redis";
import type { CacheStore } from "./types";

let store: CacheStore | null = null;

export async function initCache(): Promise<CacheStore> {
  if (store) return store;

  if (config.cacheBackend === "redis") {
    if (!config.redisUrl) {
      throw new Error("REDIS_URL is required when CACHE_BACKEND=redis");
    }
    const redis = new RedisStore(config.redisUrl, config.releaseId);
    try {
      await runCacheOperation("ping", () => redis.ping());
      store = redis;
    } catch (error) {
      if (config.cacheRequired) throw error;
      logError(error, { msg: "redis unavailable at startup; continuing without cache hits" });
      // Keep the Redis adapter: ioredis reconnects in the background. Read/write
      // wrappers below fail open until the shared backend becomes available.
      store = redis;
    }
  } else {
    store = new MemoryStore(config.cacheMaxEntries);
  }

  return store;
}

export function getCache(): CacheStore {
  if (!store) throw new Error("Cache not initialized — call initCache() first");
  return store;
}

export async function closeCache(): Promise<void> {
  await store?.close?.();
  store = null;
}

export function cacheKey(policy: CachePolicy): string | null {
  return policy.kind === "shared" ? formatCacheKey(policy.key) : null;
}

export async function read(
  key: string,
): Promise<{ body: string; state: "fresh" | "stale" } | null> {
  try {
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

export async function write(key: string, body: string, policy: CachePolicy): Promise<boolean> {
  try {
    await runCacheOperation("write", () => getCache().write(key, body, policy));
    observeCacheEntryWrite(key, body);
    return true;
  } catch (error) {
    logError(error, { msg: "cache write failed", key });
    return false;
  }
}

export async function deleteKey(key: string): Promise<boolean> {
  return runCacheOperation("delete", () => getCache().deleteKey(key));
}

export function cacheControl(policy: CachePolicy): string {
  if (policy.kind === "none") return "private, no-store";
  // Redis is the shared HTML body cache. Do not implicitly turn every browser/CDN
  // between the user and the origin into a second cache with an unknown Vary key.
  return "private, no-cache, max-age=0";
}

export async function pingCache(): Promise<boolean> {
  const cache = getCache();
  try {
    return cache.ping ? await runCacheOperation("ping", () => cache.ping!()) : true;
  } catch (error) {
    logger.warn("cache ping failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
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
  if (!cache.acquireLock) return { kind: "acquired", token: crypto.randomUUID() };
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

async function runCacheOperation<T>(
  operation: string,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    `cache.${operation}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "cache.backend": config.cacheBackend,
        ...(config.cacheBackend === "redis" ? { "db.system.name": "redis" } : {}),
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
        observeCacheOperation(config.cacheBackend, operation, outcome, performance.now() - started);
      }
    },
  );
}
