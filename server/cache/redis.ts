import { logger } from "@server/logger";
import Redis from "ioredis";

import type { CachePolicy } from "~/lib/types";

import { decodeCacheEntry, encodeCacheEntry } from "./codec";
import type {
  CacheEntry,
  CacheStore,
  ListKeysOptions,
  ListKeysResult,
  RateLimitResult,
} from "./types";

export class RedisStore implements CacheStore {
  private redis: Redis;
  private readonly prefix: string;

  constructor(url: string, namespace = "development") {
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
  }

  private redisKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private matchPattern(prefix?: string): string {
    return prefix ? `${this.prefix}${prefix}*` : `${this.prefix}*`;
  }

  async read(key: string): Promise<{ body: string; state: "fresh" | "stale" } | null> {
    const raw = await this.redis.getBuffer(this.redisKey(key));
    if (!raw) return null;

    const entry = decodeCacheEntry(raw);
    if (!entry) {
      await this.redis.del(this.redisKey(key));
      return null;
    }

    const now = Date.now();
    if (now < entry.freshUntil) return { body: entry.body, state: "fresh" };
    if (now < entry.staleUntil) return { body: entry.body, state: "stale" };

    await this.redis.del(this.redisKey(key));
    return null;
  }

  async write(key: string, body: string, policy: CachePolicy): Promise<void> {
    if (policy.kind !== "shared") return;

    const now = Date.now();
    const entry: CacheEntry = {
      body,
      freshUntil: now + policy.ttl * 1000,
      staleUntil: now + (policy.ttl + (policy.swr ?? 0)) * 1000,
    };

    const ttlSeconds = Math.max(1, policy.ttl + (policy.swr ?? 0));
    await this.redis.set(this.redisKey(key), encodeCacheEntry(entry), "EX", ttlSeconds);
  }

  async deleteKey(key: string): Promise<boolean> {
    return (await this.redis.del(this.redisKey(key))) > 0;
  }

  async deleteKeys(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return await this.redis.del(...keys.map((key) => this.redisKey(key)));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    return this.scanAndDelete(this.matchPattern(prefix || undefined));
  }

  async flushAll(): Promise<number> {
    return this.scanAndDelete(this.matchPattern());
  }

  async listKeys(options: ListKeysOptions): Promise<ListKeysResult> {
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

  private async scanAndDelete(pattern: string): Promise<number> {
    let deleted = 0;
    let cursor = "0";

    do {
      const [nextCursor, batch] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = nextCursor;
      if (batch.length > 0) {
        deleted += await this.redis.del(...batch);
      }
    } while (cursor !== "0");

    return deleted;
  }

  async ping(): Promise<boolean> {
    if (this.redis.status === "wait") await this.redis.connect();
    return (await this.redis.ping()) === "PONG";
  }

  async readEphemeral(key: string): Promise<string | null> {
    return this.redis.get(`${this.prefix}ephemeral:${key}`);
  }

  async writeEphemeral(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(`${this.prefix}ephemeral:${key}`, value, "PX", ttlMs);
  }

  async takeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}rate-limit:${key}`;
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
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      `${this.prefix}lock:${key}`,
      token,
    );
  }

  async close(): Promise<void> {
    if (this.redis.status === "end") return;
    if (this.redis.status === "ready") await this.redis.quit();
    else this.redis.disconnect();
  }
}
