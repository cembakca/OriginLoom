import { config } from "@server/config";

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
    const redis = new RedisStore(config.redisUrl);
    await redis.ping();
    store = redis;
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
  return policy.kind === "shared" ? policy.key.join("\u0000") : null;
}

export async function read(
  key: string,
): Promise<{ body: string; state: "fresh" | "stale" } | null> {
  return getCache().read(key);
}

export async function write(key: string, body: string, policy: CachePolicy): Promise<void> {
  return getCache().write(key, body, policy);
}

export function cacheControl(policy: CachePolicy): string {
  if (policy.kind === "none") return "private, no-store";
  return `public, s-maxage=${policy.ttl}, stale-while-revalidate=${policy.swr ?? 0}`;
}

export async function pingCache(): Promise<boolean> {
  const cache = getCache();
  if (cache.ping) return cache.ping();
  return true;
}
