import type { Span } from "@opentelemetry/api";
import { config } from "@server/config";
import { logError, logger } from "@server/logger";
import { observeCacheEntryWrite, observeCacheOperation, setCacheL2Health } from "@server/metrics";
import { SpanKind, withSpan } from "@server/observability";

import { formatCacheKey } from "~/lib/cache-keys";
import type { CachePolicy } from "~/lib/types";

import {
  applyInvalidationToL1,
  CacheInvalidationBus,
} from "./invalidation";
import { MemoryStore } from "./memory";
import { RedisStore } from "./redis";
import { TieredStore } from "./tiered";
import type { CacheStore } from "./types";
import type { RateLimitResult } from "./types";

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

export function cacheTopology(): CacheTopology {
  return runtimeCacheBackend() === "redis" && runtimeRedisUrl() ? "memory+redis" : "memory";
}

export function isL2Configured(): boolean {
  return runtimeCacheBackend() === "redis" && Boolean(runtimeRedisUrl());
}

export async function initCache(): Promise<CacheStore> {
  if (store) return store;

  const l1 = new MemoryStore(config.cacheMaxEntries);
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

      invalidation = new CacheInvalidationBus(
        l2.getClient(),
        config.releaseId,
        (message) => applyInvalidationToL1(l1, message),
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
  await invalidationBus?.close();
  invalidationBus = null;
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
