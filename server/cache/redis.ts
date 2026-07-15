import Redis from "ioredis";
import type { CachePolicy } from "../../src/lib/types";
import type { CacheEntry, CacheStore } from "./types";

export class RedisStore implements CacheStore {
  private redis: Redis;
  private readonly prefix = "ssr:";

  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  }

  private redisKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async read(key: string): Promise<{ body: string; state: "fresh" | "stale" } | null> {
    const raw = await this.redis.get(this.redisKey(key));
    if (!raw) return null;

    const entry: CacheEntry = JSON.parse(raw);
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
    await this.redis.set(this.redisKey(key), JSON.stringify(entry), "EX", ttlSeconds);
  }

  async ping(): Promise<boolean> {
    if (this.redis.status === "wait") await this.redis.connect();
    return (await this.redis.ping()) === "PONG";
  }

  async close(): Promise<void> {
    if (this.redis.status === "end") return;
    await this.redis.quit();
  }
}
