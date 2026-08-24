import type { CachePolicy } from "@originloom/shared/lib/types";

import { logError } from "../logger.js";
import { observeCachePromotion } from "../metrics.js";
import type { CacheInvalidationPublisher } from "./invalidation.js";
import type { CacheMemoryWriteOptions, CacheNamespace } from "./l1-policy.js";
import type { MemoryStore } from "./memory.js";
import type { RedisStore } from "./redis.js";
import { MAX_TAG_KEYS } from "./tags.js";
import {
  buildCacheEntry,
  type CacheEntry,
  cacheEntryFragmentMarkers,
  type CacheReadResult,
  type CacheStore,
  type ListKeysOptions,
  type ListKeysResult,
  type RateLimitResult,
  type TagInvalidationResult,
} from "./types.js";

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

  /**
   * L1-only, synchronous — never touches L2/Redis. A miss here is not a real
   * miss, just "not cheaply servable"; the caller must fall back to `read()`.
   * Carries L1's MRU/eviction side effects — see `CacheStore.readSync`.
   */
  readSync(key: string): CacheReadResult | null {
    return this.l1.readSync(key);
  }

  async read(key: string): Promise<CacheReadResult | null> {
    const l1Hit = await this.l1.read(key);
    if (l1Hit) return l1Hit;

    if (!this.l2) return null;

    try {
      const l2Hit = await this.l2.readEntry(key);
      if (!l2Hit) return null;
      if (await this.promoteToL1(key, l2Hit.entry)) observeCachePromotion("l2");
      const fragmentMarkers = cacheEntryFragmentMarkers(l2Hit.entry);
      return {
        body: l2Hit.entry.body,
        state: l2Hit.state,
        hasFragments: fragmentMarkers.length > 0,
        fragmentMarkers,
        ...(l2Hit.entry.tags?.length ? { tags: l2Hit.entry.tags } : {}),
      };
    } catch (error) {
      logError(error, { msg: "L2 cache read failed; treating as miss", key });
      return null;
    }
  }

  async write(
    key: string,
    body: string,
    policy: CachePolicy,
    memory?: CacheMemoryWriteOptions,
  ): Promise<boolean> {
    if (policy.kind !== "shared") return false;

    const entry = buildCacheEntry(body, policy, memory);
    let l2Written = false;

    if (this.l2) {
      try {
        l2Written = await this.l2.writeEntry(key, entry, policy);
        if (!l2Written && entry.tags?.length) return false;
        // Tell other pods to drop their L1 copy so the next read on each of
        // them re-fetches this fresher entry from L2 instead of serving a
        // stale one until its own (unrelated) staleUntil elapses.
        await this.invalidation?.publishKey(key);
      } catch (error) {
        logError(error, { msg: "L2 cache write failed; continuing with L1 only", key });
      }
    }

    return (await this.l1.writeEntry(key, entry)) || l2Written;
  }

  async attachMemoryValue(
    key: string,
    value: unknown,
    valueBytes: number,
    namespace: CacheNamespace,
  ): Promise<boolean> {
    return this.l1.attachMemoryValue(key, value, valueBytes, namespace);
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

  async keysByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult> {
    const l1 = await this.l1.keysByTags(tags, limit + 1);
    if (!this.l2) {
      return {
        keys: l1.keys.slice(0, limit),
        truncated: l1.truncated || l1.keys.length > limit,
      };
    }
    const l2 = await this.l2.keysByTags(tags, limit + 1);
    const keys = [...new Set([...l1.keys, ...l2.keys])];
    return {
      keys: keys.slice(0, limit),
      truncated: l1.truncated || l2.truncated || keys.length > limit,
    };
  }

  async deleteByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult> {
    const matches = await this.keysByTags(tags, limit);
    const deleted = new Set(this.l1.deleteKeysReturningNames(matches.keys));
    if (this.l2) {
      try {
        for (const key of await this.l2.deleteKeysReturningNames(matches.keys)) deleted.add(key);
        await this.invalidation?.publishTags(tags);
      } catch (error) {
        logError(error, { msg: "L2 cache deleteByTags failed", tags });
      }
    }
    return { keys: [...deleted], truncated: matches.truncated };
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
    if (options.tag) {
      const offset = Number(options.cursor ?? 0);
      const result = await this.keysByTags([options.tag], MAX_TAG_KEYS);
      const keys = result.keys.slice(offset, offset + options.limit);
      const nextOffset = offset + options.limit;
      return {
        keys,
        ...(nextOffset < result.keys.length ? { nextCursor: String(nextOffset) } : {}),
        ...(result.truncated ? { truncated: true } : {}),
      };
    }
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

  async acquireCoordinationLock(key: string, ttlMs: number): Promise<string | null> {
    if (this.l2) return this.l2.acquireCoordinationLock(key, ttlMs);
    return this.l1.acquireCoordinationLock(key, ttlMs);
  }

  async releaseCoordinationLock(key: string, token: string): Promise<void> {
    if (this.l2) return this.l2.releaseCoordinationLock(key, token);
    return this.l1.releaseCoordinationLock(key, token);
  }

  async close(): Promise<void> {
    await this.invalidation?.close();
    await this.l1.close();
    await this.l2?.close?.();
  }

  /** Clears L1 only — used by invalidation subscriber and reconnect safety. */
  flushL1(): number {
    return this.l1.flushAllSync();
  }

  private async promoteToL1(key: string, entry: CacheEntry): Promise<boolean> {
    return this.l1.writeEntry(key, entry);
  }
}
