import type { CachePolicy } from "@originloom/react/lib/types";
import type { CacheInvalidationPublisher } from "@server/cache/invalidation";
import type { MemoryStore } from "@server/cache/memory";
import type { RedisStore } from "@server/cache/redis";
import { logError } from "@server/logger";
import { observeCachePromotion } from "@server/metrics";

import {
  buildCacheEntry,
  type CacheEntry,
  type CacheStore,
  type ListKeysOptions,
  type ListKeysResult,
  type RateLimitResult,
} from "./types";

export type TieredStoreOptions = {
  l1: MemoryStore;
  l2: RedisStore | null;
  invalidation?: CacheInvalidationPublisher | undefined;
};

/** L1 process memory with optional L2 Redis. L2 holds cross-pod truth and coordination. */
export class TieredStore implements CacheStore {
  readonly l1: MemoryStore;
  readonly l2: RedisStore | null;
  private readonly invalidation: CacheInvalidationPublisher | undefined;

  constructor(options: TieredStoreOptions) {
    this.l1 = options.l1;
    this.l2 = options.l2;
    this.invalidation = options.invalidation;
  }

  get hasL2(): boolean {
    return this.l2 !== null;
  }

  async read(key: string): Promise<{ body: string; state: "fresh" | "stale" } | null> {
    const l1Hit = await this.l1.read(key);
    if (l1Hit) return l1Hit;

    if (!this.l2) return null;

    try {
      const l2Hit = await this.l2.readEntry(key);
      if (!l2Hit) return null;
      await this.promoteToL1(key, l2Hit.entry);
      observeCachePromotion("l2");
      return { body: l2Hit.entry.body, state: l2Hit.state };
    } catch (error) {
      logError(error, { msg: "L2 cache read failed; treating as miss", key });
      return null;
    }
  }

  async write(key: string, body: string, policy: CachePolicy): Promise<void> {
    if (policy.kind !== "shared") return;

    const entry = buildCacheEntry(body, policy);

    if (this.l2) {
      try {
        await this.l2.writeEntry(key, entry, policy);
        // Tell other pods to drop their L1 copy so the next read on each of
        // them re-fetches this fresher entry from L2 instead of serving a
        // stale one until its own (unrelated) staleUntil elapses.
        await this.invalidation?.publishKey(key);
      } catch (error) {
        logError(error, { msg: "L2 cache write failed; continuing with L1 only", key });
      }
    }

    await this.l1.writeEntry(key, entry);
  }

  async deleteKey(key: string): Promise<boolean> {
    const l1Deleted = await this.l1.deleteKey(key);
    let l2Deleted = false;
    if (this.l2) {
      try {
        l2Deleted = await this.l2.deleteKey(key);
        await this.invalidation?.publishKey(key);
      } catch (error) {
        logError(error, { msg: "L2 cache delete failed", key });
      }
    }
    return l1Deleted || l2Deleted;
  }

  async deleteKeys(keys: string[]): Promise<number> {
    const deleted = new Set(this.l1.deleteKeysReturningNames(keys));
    if (this.l2 && keys.length > 0) {
      try {
        for (const key of await this.l2.deleteKeysReturningNames(keys)) deleted.add(key);
        await this.invalidation?.publishKeys(keys);
      } catch (error) {
        logError(error, { msg: "L2 cache deleteKeys failed", count: keys.length });
      }
    }
    return deleted.size;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const deleted = new Set(this.l1.deleteByPrefixReturningNames(prefix));
    if (this.l2) {
      try {
        for (const key of await this.l2.deleteByPrefixReturningNames(prefix)) deleted.add(key);
        await this.invalidation?.publishPrefix(prefix);
      } catch (error) {
        logError(error, { msg: "L2 cache deleteByPrefix failed", prefix });
      }
    }
    return deleted.size;
  }

  async flushAll(): Promise<number> {
    const deleted = new Set(this.l1.flushAllReturningNames());
    if (this.l2) {
      try {
        for (const key of await this.l2.flushAllReturningNames()) deleted.add(key);
        await this.invalidation?.publishFlushAll();
      } catch (error) {
        logError(error, { msg: "L2 cache flushAll failed" });
      }
    }
    return deleted.size;
  }

  async listKeys(options: ListKeysOptions): Promise<ListKeysResult> {
    if (this.l2) return this.l2.listKeys(options);
    return this.l1.listKeys(options);
  }

  async ping(): Promise<boolean> {
    if (!this.l2) return true;
    return this.l2.ping();
  }

  async readEphemeral(key: string): Promise<string | null> {
    if (this.l2) return this.l2.readEphemeral(key);
    return this.l1.readEphemeral(key);
  }

  async writeEphemeral(key: string, value: string, ttlMs: number): Promise<void> {
    if (this.l2) return this.l2.writeEphemeral(key, value, ttlMs);
    return this.l1.writeEphemeral(key, value, ttlMs);
  }

  async takeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    if (this.l2) return this.l2.takeRateLimit(key, limit, windowMs);
    return this.l1.takeRateLimit(key, limit, windowMs);
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    if (this.l2) return this.l2.acquireLock(key, ttlMs);
    return this.l1.acquireLock(key, ttlMs);
  }

  async releaseLock(key: string, token: string): Promise<void> {
    if (this.l2) return this.l2.releaseLock(key, token);
    return this.l1.releaseLock(key, token);
  }

  async close(): Promise<void> {
    await this.invalidation?.close();
    await this.l2?.close?.();
  }

  /** Clears L1 only — used by invalidation subscriber and reconnect safety. */
  flushL1(): number {
    return this.l1.flushAllSync();
  }

  private async promoteToL1(key: string, entry: CacheEntry): Promise<void> {
    await this.l1.writeEntry(key, entry);
  }
}
