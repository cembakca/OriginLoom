import { findSsrFragmentMarkers, type SsrFragmentMarker } from "@originloom/shared/fragment-markup";
import type { CachePolicy } from "@originloom/shared/lib/types";

export type CacheEntry = {
  body: string;
  freshUntil: number;
  staleUntil: number;
  /** Derived on write; optional keeps manually constructed legacy entries compatible. */
  hasFragments?: boolean;
  /** Compiled marker positions; optional for entries produced by older releases. */
  fragmentMarkers?: readonly SsrFragmentMarker[];
};

export type CacheReadResult = {
  body: string;
  state: "fresh" | "stale";
  hasFragments: boolean;
  fragmentMarkers: readonly SsrFragmentMarker[];
};

export type ListKeysOptions = {
  prefix?: string;
  limit: number;
  cursor?: string;
};

export type ListKeysResult = {
  keys: string[];
  nextCursor?: string;
};

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export function buildCacheEntry(
  body: string,
  policy: CachePolicy & { kind: "shared" },
): CacheEntry {
  const now = Date.now();
  const fragmentMarkers = findSsrFragmentMarkers(body);
  return {
    body,
    hasFragments: fragmentMarkers.length > 0,
    fragmentMarkers,
    freshUntil: now + policy.ttl * 1000,
    staleUntil: now + (policy.ttl + (policy.swr ?? 0)) * 1000,
  };
}

export function cacheEntryFragmentMarkers(entry: CacheEntry): readonly SsrFragmentMarker[] {
  return entry.fragmentMarkers ?? findSsrFragmentMarkers(entry.body);
}

export interface CacheStore {
  read(key: string): Promise<CacheReadResult | null>;
  write(key: string, body: string, policy: CachePolicy): Promise<void>;
  deleteKey(key: string): Promise<boolean>;
  deleteKeys(keys: string[]): Promise<number>;
  deleteByPrefix(prefix: string): Promise<number>;
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
