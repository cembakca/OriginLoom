import { findSsrFragmentMarkers, type SsrFragmentMarker } from "@originloom/shared/fragment-markup";
import type { CachePolicy } from "@originloom/shared/lib/types";

import type { CacheMemoryWriteOptions, CacheNamespace } from "./l1-policy.js";
import { normalizeDependencyTags } from "./tags.js";

export type CacheEntry = {
  body: string;
  freshUntil: number;
  staleUntil: number;
  /** Derived on write; optional keeps manually constructed legacy entries compatible. */
  hasFragments?: boolean;
  /** Compiled marker positions; optional for entries produced by older releases. */
  fragmentMarkers?: readonly SsrFragmentMarker[];
  /** Stable resource dependencies; serialized to L2 and indexed by every store. */
  tags?: readonly string[];
  /** L1-only metadata; Redis codec intentionally does not serialize these fields. */
  namespace?: CacheNamespace;
  memoryValue?: unknown;
  memoryValueBytes?: number;
  weightBytes?: number;
};

export type CacheReadResult = {
  body: string;
  state: "fresh" | "stale";
  hasFragments: boolean;
  fragmentMarkers: readonly SsrFragmentMarker[];
  tags?: readonly string[];
  /** Present only when a typed resource is already materialized in process memory. */
  memoryValue?: unknown;
};

export type ListKeysOptions = {
  prefix?: string;
  tag?: string;
  limit: number;
  cursor?: string;
};

export type ListKeysResult = {
  keys: string[];
  nextCursor?: string;
  truncated?: boolean;
};

export type TagInvalidationResult = {
  keys: string[];
  truncated: boolean;
};

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export function buildCacheEntry(
  body: string,
  policy: CachePolicy & { kind: "shared" },
  memory?: CacheMemoryWriteOptions,
): CacheEntry {
  const now = Date.now();
  const fragmentMarkers = findSsrFragmentMarkers(body);
  const tags = normalizeDependencyTags(policy.tags);
  return {
    body,
    hasFragments: fragmentMarkers.length > 0,
    fragmentMarkers,
    ...(tags.length ? { tags } : {}),
    ...memory,
    freshUntil: now + policy.ttl * 1000,
    staleUntil: now + (policy.ttl + (policy.swr ?? 0)) * 1000,
  };
}

export function cacheEntryFragmentMarkers(entry: CacheEntry): readonly SsrFragmentMarker[] {
  return entry.fragmentMarkers ?? findSsrFragmentMarkers(entry.body);
}

export interface CacheStore {
  read(key: string): Promise<CacheReadResult | null>;
  /**
   * Synchronous, untraced, in-process-only lookup. Optional: a store that
   * cannot offer an in-memory fast path (e.g. Redis-only) simply omits it, and
   * every caller falls back to the fully-traced `read()`. Never checks L2 — a
   * null here means "not cheaply servable", never "not cached".
   *
   * Deliberately NOT named `peek`: this is a real read with a real read's side
   * effects. It moves the entry to MRU, and it evicts (and reports an
   * `expired` eviction for) an entry past `staleUntil`. Anything that wants to
   * inspect the cache without disturbing it — a debug endpoint, an
   * "is this cached?" probe — must not use this method.
   */
  readSync?(key: string): CacheReadResult | null;
  write(
    key: string,
    body: string,
    policy: CachePolicy,
    memory?: CacheMemoryWriteOptions,
  ): Promise<boolean>;
  attachMemoryValue?(
    key: string,
    value: unknown,
    valueBytes: number,
    namespace: CacheNamespace,
  ): Promise<boolean>;
  deleteKey(key: string): Promise<boolean>;
  deleteKeys(keys: string[]): Promise<number>;
  deleteByPrefix(prefix: string): Promise<number>;
  keysByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult>;
  deleteByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult>;
  flushAll(): Promise<number>;
  listKeys(options: ListKeysOptions): Promise<ListKeysResult>;
  readEphemeral?(key: string): Promise<string | null>;
  writeEphemeral?(key: string, value: string, ttlMs: number): Promise<void>;
  takeRateLimit?(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  acquireLock?(key: string, ttlMs: number): Promise<string | null>;
  releaseLock?(key: string, token: string): Promise<void>;
  ping?(): Promise<boolean>;
  close?(): Promise<void>;
}
