import { parseCacheKey } from "./key-codec.js";

export const CACHE_NAMESPACES = ["page", "data", "fragment", "negative"] as const;

export type CacheNamespace = (typeof CACHE_NAMESPACES)[number];

export type CacheNamespaceBudget = {
  maxBytes: number;
  reserveBytes: number;
};

export type CacheNamespaceBudgets = Record<CacheNamespace, CacheNamespaceBudget>;

export type L1MemoryOptions = {
  maxBytes: number;
  namespaces: CacheNamespaceBudgets;
  auxiliary: {
    maxLocks: number;
    maxEphemeralValues: number;
    maxRateLimits: number;
  };
};

export type CacheMemoryWriteOptions = {
  namespace?: CacheNamespace;
  memoryValue?: unknown;
  memoryValueBytes?: number;
};

export function inferCacheNamespace(key: string, body: string): CacheNamespace {
  const first = parseCacheKey(key)[0] ?? "";
  if (first.startsWith("fragment:")) return "fragment";
  if (first === "resource") {
    return body.includes('"result":{"kind":"not-found"') ||
      body.includes('"result":{"kind":"no-content"')
      ? "negative"
      : "data";
  }
  const start = body.trimStart().slice(0, 32).toLowerCase();
  if (start.startsWith("<!doctype html") || start.startsWith("<html")) return "page";
  return "data";
}

export function defaultL1MemoryOptions(maxEntries: number): L1MemoryOptions {
  const maxBytes = Math.max(1, maxEntries) * 256 * 1024;
  return {
    maxBytes,
    namespaces: {
      page: { maxBytes, reserveBytes: Math.floor(maxBytes * 0.4) },
      data: { maxBytes: Math.floor(maxBytes * 0.6), reserveBytes: Math.floor(maxBytes * 0.2) },
      fragment: { maxBytes: Math.floor(maxBytes * 0.3), reserveBytes: Math.floor(maxBytes * 0.1) },
      negative: { maxBytes: Math.floor(maxBytes * 0.1), reserveBytes: Math.floor(maxBytes * 0.02) },
    },
    auxiliary: {
      maxLocks: Math.max(100, maxEntries * 2),
      maxEphemeralValues: Math.max(100, maxEntries),
      maxRateLimits: Math.max(1_000, maxEntries * 5),
    },
  };
}
