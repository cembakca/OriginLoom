import type { CachePolicy } from "~/lib/types";

export type CacheEntry = { body: string; freshUntil: number; staleUntil: number };

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
  return {
    body,
    freshUntil: now + policy.ttl * 1000,
    staleUntil: now + (policy.ttl + (policy.swr ?? 0)) * 1000,
  };
}

export interface CacheStore {
  read(key: string): Promise<{ body: string; state: "fresh" | "stale" } | null>;
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
