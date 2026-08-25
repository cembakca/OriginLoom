import type { CachePolicy } from "@originloom/shared/lib/types";
import Redis from "ioredis";

import { logger } from "../logger.js";
import { decodeCacheEntry, encodeCacheEntry } from "./codec.js";
import type { CacheMemoryWriteOptions } from "./l1-policy.js";
import {
  MAX_INDEXED_TAGS,
  MAX_TAG_KEYS,
  normalizeDependencyTags,
  normalizeTagOperation,
} from "./tags.js";
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

const RESERVE_TAG_INDEX_SCRIPT = `-- originloom-tag-index-reserve
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
local newTagCount = tonumber(ARGV[8])
for i = 3 + newTagCount, #KEYS do
  redis.call('ZREM', KEYS[i], ARGV[1])
  if redis.call('ZCARD', KEYS[i]) == 0 then redis.call('ZREM', KEYS[1], KEYS[i]) end
end
local newTags = 0
for i = 3, 2 + newTagCount do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', ARGV[3])
  if not redis.call('ZSCORE', KEYS[1], KEYS[i]) then newTags = newTags + 1 end
  if not redis.call('ZSCORE', KEYS[i], ARGV[1]) and redis.call('ZCARD', KEYS[i]) >= tonumber(ARGV[4]) then
    return 0
  end
end
if redis.call('ZCARD', KEYS[1]) + newTags > tonumber(ARGV[5]) then return -1 end
local ttl = math.max(1, tonumber(ARGV[2]) - tonumber(ARGV[3]))
for i = 3, 2 + newTagCount do
  redis.call('ZADD', KEYS[i], ARGV[2], ARGV[1])
  local registryScore = redis.call('ZSCORE', KEYS[1], KEYS[i])
  if not registryScore or tonumber(registryScore) < tonumber(ARGV[2]) then
    redis.call('ZADD', KEYS[1], ARGV[2], KEYS[i])
  end
  if redis.call('PTTL', KEYS[i]) < ttl then redis.call('PEXPIRE', KEYS[i], ttl) end
end
if redis.call('PTTL', KEYS[1]) < ttl then redis.call('PEXPIRE', KEYS[1], ttl) end
redis.call('SET', KEYS[2], ARGV[6], 'EX', ARGV[7])
return 1`;

const REMOVE_TAG_MEMBERSHIPS_SCRIPT = `-- originloom-tag-index-remove
for i = 2, #KEYS do
  redis.call('ZREM', KEYS[i], ARGV[1])
  if redis.call('ZCARD', KEYS[i]) == 0 then
    redis.call('ZREM', KEYS[1], KEYS[i])
  end
end
return 1`;

const CLEAN_EMPTY_TAGS_SCRIPT = `-- originloom-tag-index-clean-empty
for i = 2, #KEYS do
  if redis.call('ZCARD', KEYS[i]) == 0 then
    redis.call('ZREM', KEYS[1], KEYS[i])
  end
end
return 1`;

export class RedisStore implements CacheStore {
  private redis: Redis;
  private readonly prefix: string;
  private readonly coordinationPrefix: string;
  private readonly tagPrefix: string;

  constructor(url: string, namespace = "development", appId = "origin-loom") {
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    });
    this.redis.on("error", (error) => {
      logger.warn("redis connection error", { error: error.message });
    });
    this.prefix = `ssr:${encodeURIComponent(namespace)}:`;
    // Namespaced by app, never by release. Two axes, and they pull in opposite
    // directions: cache entries must not survive a deploy (a new release renders
    // different HTML) while coordination state must (mid rolling deploy the two
    // releases are precisely the two parties that have to agree). What both need
    // is separation from *other products* — and for a while `RELEASE_ID` was
    // providing that by accident, because each app happened to use its own.
    // Taking coordination out of the release namespace removed the accident
    // along with the bug; this puts the intended half back, on purpose.
    this.coordinationPrefix = `ssr:coordination:${encodeURIComponent(appId)}:`;
    this.tagPrefix = `ssr-meta:${encodeURIComponent(namespace)}:tag:`;
  }

  private redisKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private matchPattern(prefix?: string): string {
    return prefix ? `${this.prefix}${prefix}*` : `${this.prefix}*`;
  }

  private tagKey(tag: string): string {
    return `${this.tagPrefix}${Buffer.from(tag, "utf8").toString("base64url")}`;
  }

  private tagRegistryKey(): string {
    return `${this.tagPrefix}__registry__`;
  }

  async read(key: string): Promise<CacheReadResult | null> {
    const hit = await this.readEntry(key);
    if (!hit) return null;
    const fragmentMarkers = cacheEntryFragmentMarkers(hit.entry);
    return {
      body: hit.entry.body,
      state: hit.state,
      hasFragments: fragmentMarkers.length > 0,
      fragmentMarkers,
      ...(hit.entry.tags?.length ? { tags: hit.entry.tags } : {}),
    };
  }

  async readEntry(key: string): Promise<{ entry: CacheEntry; state: "fresh" | "stale" } | null> {
    const raw = await this.redis.getBuffer(this.redisKey(key));
    if (!raw) return null;

    const entry = decodeCacheEntry(raw);
    if (!entry) {
      await this.redis.del(this.redisKey(key));
      return null;
    }

    const now = Date.now();
    if (now < entry.freshUntil) return { entry, state: "fresh" };
    if (now < entry.staleUntil) return { entry, state: "stale" };

    await this.redis.del(this.redisKey(key));
    await this.removeTagMemberships(key, entry.tags ?? []);
    return null;
  }

  async writeEntry(key: string, entry: CacheEntry, policy: CachePolicy): Promise<boolean> {
    if (policy.kind !== "shared") return false;
    const tags = normalizeDependencyTags(entry.tags);
    const { tags: _entryTags, ...entryWithoutTags } = entry;
    const normalizedEntry: CacheEntry = {
      ...entryWithoutTags,
      ...(tags.length ? { tags } : {}),
    };
    const ttlSeconds = Math.max(1, Math.ceil((normalizedEntry.staleUntil - Date.now()) / 1000));
    const encoded = encodeCacheEntry(normalizedEntry);
    // Untagged writes keep the original one-SET hot path. A rare tagged→untagged
    // overwrite may leave an expiry-bounded stale index member; tag lookup
    // validates current entry metadata before selecting it and removes that member.
    const previous = normalizedEntry.tags?.length ? await this.readRawEntry(key) : null;
    if (normalizedEntry.tags?.length) {
      const removedTags = (previous?.tags ?? []).filter(
        (tag) => !(normalizedEntry.tags ?? []).includes(tag),
      );
      if (!(await this.writeTaggedEntry(key, normalizedEntry, encoded, ttlSeconds, removedTags))) {
        return false;
      }
    } else {
      await this.redis.set(this.redisKey(key), encoded, "EX", ttlSeconds);
    }
    return true;
  }

  async deleteKey(key: string): Promise<boolean> {
    const entry = await this.readRawEntry(key);
    const deleted = (await this.redis.del(this.redisKey(key))) > 0;
    if (entry?.tags?.length) await this.removeTagMemberships(key, entry.tags);
    return deleted;
  }

  async deleteKeys(keys: string[]): Promise<number> {
    return (await this.deleteKeysReturningNames(keys)).length;
  }

  /** Same as deleteKeys, but reports which keys actually existed — a bulk DEL
   * only returns a count, so this pipelines individual DELs (still one round
   * trip) to get per-key results for TieredStore's exact L1∪L2 union. */
  async deleteKeysReturningNames(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const rawEntries = await this.redis.mgetBuffer(...keys.map((key) => this.redisKey(key)));
    const entries = rawEntries.map((raw) => (raw ? decodeCacheEntry(raw) : null));
    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.del(this.redisKey(key));
    const results = await pipeline.exec();
    const deleted: string[] = [];
    results?.forEach((result, index) => {
      const [error, count] = result ?? [];
      if (!error && typeof count === "number" && count > 0) deleted.push(keys[index]!);
    });
    const entriesByKey = new Map(keys.map((key, index) => [key, entries[index]] as const));
    await this.removeTagMembershipsBatch(
      deleted.map((key) => ({ key, tags: entriesByKey.get(key)?.tags ?? [] })),
    );
    return deleted;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    return (await this.deleteByPrefixReturningNames(prefix)).length;
  }

  async deleteByPrefixReturningNames(prefix: string): Promise<string[]> {
    return this.scanAndDelete(this.matchPattern(prefix || undefined));
  }

  async deleteByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult> {
    const result = await this.keysByTags(tags, limit);
    return {
      keys: await this.deleteKeysReturningNames(result.keys),
      truncated: result.truncated,
    };
  }

  async keysByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult> {
    const candidates = await this.keysForTags(normalizeTagOperation(tags), limit + 1);
    return { keys: candidates.slice(0, limit), truncated: candidates.length > limit };
  }

  async flushAll(): Promise<number> {
    return (await this.flushAllReturningNames()).length;
  }

  async flushAllReturningNames(): Promise<string[]> {
    const deleted = await this.scanAndDelete(this.matchPattern());
    await this.scanAndDelete(`${this.tagPrefix}*`, false);
    return deleted;
  }

  async listKeys(options: ListKeysOptions): Promise<ListKeysResult> {
    if (options.tag) {
      const offset = Number(options.cursor ?? 0);
      const keys = await this.keysForTags([options.tag], MAX_TAG_KEYS);
      const page = keys.slice(offset, offset + options.limit);
      const nextOffset = offset + options.limit;
      return {
        keys: page,
        ...(nextOffset < keys.length ? { nextCursor: String(nextOffset) } : {}),
      };
    }
    const pattern = this.matchPattern(options.prefix);
    const cursor = options.cursor ?? "0";
    const [nextCursor, batch] = await this.redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      options.limit,
    );

    const keys = batch.map((redisKey) => redisKey.slice(this.prefix.length));
    return {
      keys,
      ...(nextCursor !== "0" ? { nextCursor } : {}),
    };
  }

  private async scanAndDelete(pattern: string, logicalEntries = true): Promise<string[]> {
    const deleted: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = nextCursor;
      if (batch.length > 0) {
        if (logicalEntries) {
          deleted.push(
            ...(await this.deleteKeysReturningNames(
              batch.map((key) => key.slice(this.prefix.length)),
            )),
          );
        } else {
          await this.redis.del(...batch);
        }
      }
    } while (cursor !== "0");

    return deleted;
  }

  async ping(): Promise<boolean> {
    if (this.redis.status === "wait") await this.redis.connect();
    return (await this.redis.ping()) === "PONG";
  }

  async readEphemeral(key: string): Promise<string | null> {
    return this.redis.get(`${this.coordinationPrefix}ephemeral:${key}`);
  }

  async writeEphemeral(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(`${this.coordinationPrefix}ephemeral:${key}`, value, "PX", ttlMs);
  }

  async takeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    // Coordination, not cache. A counter namespaced by release forgets everyone
    // at every deploy — and worse, during a rolling one the two releases keep
    // two separate windows, so a caller gets the full allowance from each and
    // the ceiling doubles for as long as the rollout lasts. The limit is about
    // the caller, and the caller does not redeploy.
    const redisKey = `${this.coordinationPrefix}rate-limit:${key}`;
    const result = (await this.redis.eval(
      "local count = redis.call('INCR', KEYS[1]); " +
        "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; " +
        "local ttl = redis.call('PTTL', KEYS[1]); return {count, ttl}",
      1,
      redisKey,
      windowMs,
    )) as [number, number];
    return {
      allowed: result[0] <= limit,
      retryAfterMs: Math.max(1, result[1]),
    };
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const result = await this.redis.set(`${this.prefix}lock:${key}`, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await this.releaseLockAt(`${this.prefix}lock:${key}`, token);
  }

  async acquireCoordinationLock(key: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const redisKey = `${this.coordinationPrefix}lock:${key}`;
    return (await this.redis.set(redisKey, token, "PX", ttlMs, "NX")) === "OK" ? token : null;
  }

  async releaseCoordinationLock(key: string, token: string): Promise<void> {
    await this.releaseLockAt(`${this.coordinationPrefix}lock:${key}`, token);
  }

  /** Compare-and-delete, so a lock that already expired is not stolen from its next holder. */
  private async releaseLockAt(redisKey: string, token: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      redisKey,
      token,
    );
  }

  async write(
    key: string,
    body: string,
    policy: CachePolicy,
    _memory?: CacheMemoryWriteOptions,
  ): Promise<boolean> {
    if (policy.kind !== "shared") return false;
    return this.writeEntry(key, buildCacheEntry(body, policy), policy);
  }

  private async readRawEntry(key: string): Promise<CacheEntry | null> {
    const raw = await this.redis.getBuffer(this.redisKey(key));
    return raw ? decodeCacheEntry(raw) : null;
  }

  private async writeTaggedEntry(
    key: string,
    entry: CacheEntry,
    encoded: Buffer,
    ttlSeconds: number,
    removedTags: readonly string[],
  ): Promise<boolean> {
    const tags = entry.tags ?? [];
    const result = await this.redis.eval(
      RESERVE_TAG_INDEX_SCRIPT,
      tags.length + removedTags.length + 2,
      this.tagRegistryKey(),
      this.redisKey(key),
      ...tags.map((tag) => this.tagKey(tag)),
      ...removedTags.map((tag) => this.tagKey(tag)),
      key,
      entry.staleUntil,
      Date.now(),
      MAX_TAG_KEYS,
      MAX_INDEXED_TAGS,
      encoded,
      ttlSeconds,
      tags.length,
    );
    return Number(result) === 1;
  }

  private async removeTagMemberships(key: string, tags: readonly string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.redis.eval(
      REMOVE_TAG_MEMBERSHIPS_SCRIPT,
      tags.length + 1,
      this.tagRegistryKey(),
      ...tags.map((tag) => this.tagKey(tag)),
      key,
    );
  }

  private async removeTagMembershipsBatch(
    entries: readonly { key: string; tags: readonly string[] }[],
  ): Promise<void> {
    const membersByTag = new Map<string, string[]>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        const members = membersByTag.get(tag) ?? [];
        members.push(entry.key);
        membersByTag.set(tag, members);
      }
    }
    if (membersByTag.size === 0) return;

    const pipeline = this.redis.pipeline();
    for (const [tag, members] of membersByTag) pipeline.zrem(this.tagKey(tag), ...members);
    await pipeline.exec();
    const tagKeys = [...membersByTag.keys()].map((tag) => this.tagKey(tag));
    await this.redis.eval(
      CLEAN_EMPTY_TAGS_SCRIPT,
      tagKeys.length + 1,
      this.tagRegistryKey(),
      ...tagKeys,
    );
  }

  private async keysForTags(tags: readonly string[], limit: number): Promise<string[]> {
    const normalized = normalizeTagOperation(tags);
    const keys = new Set<string>();
    for (const tag of normalized) {
      const tagKey = this.tagKey(tag);
      await this.redis.zremrangebyscore(tagKey, "-inf", Date.now());
      const candidates = await this.redis.zrangebyscore(
        tagKey,
        Date.now(),
        "+inf",
        "LIMIT",
        0,
        limit,
      );
      if (candidates.length === 0) continue;
      const rawEntries = await this.redis.mgetBuffer(
        ...candidates.map((candidate) => this.redisKey(candidate)),
      );
      const staleMembers: string[] = [];
      const corruptEntries: string[] = [];
      for (const [index, key] of candidates.entries()) {
        const raw = rawEntries[index];
        const entry = raw ? decodeCacheEntry(raw) : null;
        if (entry?.tags?.includes(tag)) keys.add(key);
        else {
          staleMembers.push(key);
          if (raw && !entry) corruptEntries.push(this.redisKey(key));
        }
        if (keys.size >= limit) break;
      }
      if (corruptEntries.length > 0) await this.redis.del(...corruptEntries);
      if (staleMembers.length > 0) await this.redis.zrem(tagKey, ...staleMembers);
      if (keys.size >= limit) return [...keys];
    }
    return [...keys];
  }

  duplicateClient(): Redis {
    return this.redis.duplicate();
  }

  getClient(): Redis {
    return this.redis;
  }

  async close(): Promise<void> {
    if (this.redis.status === "end") return;
    if (this.redis.status === "ready") await this.redis.quit();
    else this.redis.disconnect();
  }
}
