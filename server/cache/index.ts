import { config } from "@server/config";
import { logError, logger } from "@server/logger";

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
      await redis.ping();
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
    return await getCache().read(key);
  } catch (error) {
    logError(error, { msg: "cache read failed", key });
    return null;
  }
}

export async function write(key: string, body: string, policy: CachePolicy): Promise<boolean> {
  try {
    await getCache().write(key, body, policy);
    return true;
  } catch (error) {
    logError(error, { msg: "cache write failed", key });
    return false;
  }
}

export async function deleteKey(key: string): Promise<boolean> {
  return getCache().deleteKey(key);
}

export function cacheControl(policy: CachePolicy): string {
  if (policy.kind === "none") return "private, no-store";
  return `public, s-maxage=${policy.ttl}, stale-while-revalidate=${policy.swr ?? 0}`;
}

export async function pingCache(): Promise<boolean> {
  const cache = getCache();
  try {
    return cache.ping ? await cache.ping() : true;
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
    return await cache.acquireLock(key, ttlMs);
  } catch (error) {
    logError(error, { msg: "cache lock failed", key });
    return null;
  }
}

export async function releaseRevalidationLock(key: string, token: string): Promise<void> {
  const cache = getCache();
  if (!cache.releaseLock) return;
  try {
    await cache.releaseLock(key, token);
  } catch (error) {
    logError(error, { msg: "cache unlock failed", key });
  }
}
