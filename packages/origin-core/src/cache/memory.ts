import type { CachePolicy } from "@originloom/shared/lib/types";

import {
  buildCacheEntry,
  type CacheEntry,
  cacheEntryFragmentMarkers,
  type CacheReadResult,
  type CacheStore,
  type ListKeysOptions,
  type ListKeysResult,
  type RateLimitResult,
} from "./types.js";

export class MemoryStore implements CacheStore {
  private store = new Map<string, CacheEntry>();
  private locks = new Map<string, { token: string; expiresAt: number }>();
  private ephemeral = new Map<string, { value: string; expiresAt: number }>();
  private rateLimits = new Map<string, { used: number; resetAt: number }>();

  constructor(private maxEntries: number) {}

  get size(): number {
    return this.store.size;
  }

  async read(key: string): Promise<CacheReadResult | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    const fragmentMarkers = cacheEntryFragmentMarkers(entry);
    if (now < entry.freshUntil)
      return {
        body: entry.body,
        state: "fresh",
        hasFragments: fragmentMarkers.length > 0,
        fragmentMarkers,
      };
    if (now < entry.staleUntil)
      return {
        body: entry.body,
        state: "stale",
        hasFragments: fragmentMarkers.length > 0,
        fragmentMarkers,
      };

    this.store.delete(key);
    return null;
  }

  async write(key: string, body: string, policy: CachePolicy): Promise<void> {
    if (policy.kind !== "shared") return;
    await this.writeEntry(key, buildCacheEntry(body, policy));
  }

  /** Writes an entry preserving absolute fresh/stale deadlines (L2 promotion path). */
  async writeEntry(key: string, entry: CacheEntry): Promise<void> {
    const now = Date.now();
    if (now >= entry.staleUntil) return;
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      this.store.delete(this.store.keys().next().value!);
    }
    this.store.set(key, entry);
  }

  /** Synchronous L1 flush for invalidation subscriber reconnect safety. */
  flushAllSync(): number {
    const deleted = this.store.size;
    this.store.clear();
    return deleted;
  }

  async deleteKey(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async deleteKeys(keys: string[]): Promise<number> {
    return this.deleteKeysReturningNames(keys).length;
  }

  /** Same as deleteKeys, but reports which keys actually existed — used by
   * TieredStore to compute an exact L1∪L2 union instead of guessing from counts. */
  deleteKeysReturningNames(keys: string[]): string[] {
    const deleted: string[] = [];
    for (const key of keys) {
      if (this.store.delete(key)) deleted.push(key);
    }
    return deleted;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    return this.deleteByPrefixReturningNames(prefix).length;
  }

  deleteByPrefixReturningNames(prefix: string): string[] {
    const deleted: string[] = [];
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted.push(key);
      }
    }
    return deleted;
  }

  async flushAll(): Promise<number> {
    return this.flushAllReturningNames().length;
  }

  flushAllReturningNames(): string[] {
    const deleted = [...this.store.keys()];
    this.store.clear();
    return deleted;
  }

  async listKeys(options: ListKeysOptions): Promise<ListKeysResult> {
    const offset = Number(options.cursor ?? 0);
    const filtered = [...this.store.keys()].filter((key) =>
      options.prefix ? key.startsWith(options.prefix) : true,
    );
    const keys = filtered.slice(offset, offset + options.limit);
    const nextOffset = offset + options.limit;
    return {
      keys,
      ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async readEphemeral(key: string): Promise<string | null> {
    const entry = this.ephemeral.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.ephemeral.delete(key);
      return null;
    }
    return entry.value;
  }

  async writeEphemeral(key: string, value: string, ttlMs: number): Promise<void> {
    this.ephemeral.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async takeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    let entry = this.rateLimits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { used: 0, resetAt: now + windowMs };
      this.rateLimits.set(key, entry);
    }
    entry.used++;
    return {
      allowed: entry.used <= limit,
      retryAfterMs: Math.max(1, entry.resetAt - now),
    };
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const current = this.locks.get(key);
    if (current && current.expiresAt > Date.now()) return null;
    const token = crypto.randomUUID();
    this.locks.set(key, { token, expiresAt: Date.now() + ttlMs });
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }
}

export function memorySize(store: MemoryStore): number {
  return store.size;
}
