import type { CachePolicy } from "@originloom/shared/lib/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const redisData = new Map<string, Buffer>();
const redisZsets = new Map<string, Map<string, number>>();
const published: string[] = [];

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

vi.mock("ioredis", () => ({
  default: class RedisMock {
    status = "ready";
    private handlers = new Map<string, Set<(channel: string, message: string) => void>>();

    get = vi.fn(async (key: string) => redisData.get(key)?.toString("utf8") ?? null);
    getBuffer = vi.fn(async (key: string) => redisData.get(key) ?? null);
    mgetBuffer = vi.fn(async (...keys: string[]) => keys.map((key) => redisData.get(key) ?? null));
    set = vi.fn(async (key: string, value: string | Buffer, ...args: unknown[]) => {
      if (args.includes("NX") && redisData.has(key)) return null;
      redisData.set(key, toBuffer(value));
      return "OK";
    });
    del = vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (redisData.delete(key)) count++;
        else if (redisZsets.delete(key)) count++;
      }
      return count;
    });
    pipeline = vi.fn(() => {
      const ops: Array<() => [null, number]> = [];
      const chain = {
        del: (key: string) => {
          ops.push(() => [null, redisData.delete(key) || redisZsets.delete(key) ? 1 : 0]);
          return chain;
        },
        zrem: (key: string, ...members: string[]) => {
          ops.push(() => {
            let deleted = 0;
            for (const member of members) {
              if (redisZsets.get(key)?.delete(member)) deleted++;
            }
            return [null, deleted];
          });
          return chain;
        },
        exec: async () => ops.map((op) => op()),
      };
      return chain;
    });
    ping = vi.fn(async () => "PONG");
    publish = vi.fn(async (_channel: string, message: string) => {
      published.push(message);
      return 1;
    });
    subscribe = vi.fn(async (channel: string) => {
      this.handlers.set(channel, this.handlers.get(channel) ?? new Set());
    });
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "message") {
        this.messageHandler = handler;
      }
    });
    duplicate = vi.fn(() => new RedisMock());
    eval = vi.fn(async (script: string, keyCount: number, ...args: unknown[]) => {
      if (script.includes("originloom-tag-index-reserve")) {
        const redisKeys = args.slice(0, keyCount) as string[];
        const logicalKey = args[keyCount] as string;
        const staleUntil = Number(args[keyCount + 1]);
        const encoded = args[keyCount + 5] as Buffer;
        const newTagCount = Number(args[keyCount + 7]);
        redisData.set(redisKeys[1]!, encoded);
        for (const tagKey of redisKeys.slice(2 + newTagCount)) {
          const set = redisZsets.get(tagKey);
          set?.delete(logicalKey);
          if (set?.size === 0) redisZsets.delete(tagKey);
        }
        for (const tagKey of redisKeys.slice(2, 2 + newTagCount)) {
          const set = redisZsets.get(tagKey) ?? new Map<string, number>();
          set.set(logicalKey, staleUntil);
          redisZsets.set(tagKey, set);
        }
        return 1;
      }
      if (script.includes("originloom-tag-index-remove")) {
        const redisKeys = args.slice(0, keyCount) as string[];
        const logicalKey = args[keyCount] as string;
        for (const tagKey of redisKeys.slice(1)) {
          const set = redisZsets.get(tagKey);
          set?.delete(logicalKey);
          if (set?.size === 0) redisZsets.delete(tagKey);
        }
        return 1;
      }
      if (script.includes("originloom-tag-index-clean-empty")) {
        const redisKeys = args.slice(0, keyCount) as string[];
        for (const tagKey of redisKeys.slice(1)) {
          if ((redisZsets.get(tagKey)?.size ?? 0) === 0) redisZsets.delete(tagKey);
        }
        return 1;
      }
      const [key, token] = args as [string, string];
      if (redisData.get(key)?.toString("utf8") !== token) return 0;
      redisData.delete(key);
      return 1;
    });
    zrem = vi.fn(async (key: string, member: string) =>
      redisZsets.get(key)?.delete(member) ? 1 : 0,
    );
    zremrangebyscore = vi.fn(async (key: string, _min: string, max: number) => {
      let deleted = 0;
      for (const [member, score] of redisZsets.get(key) ?? []) {
        if (score <= Number(max)) {
          redisZsets.get(key)!.delete(member);
          deleted++;
        }
      }
      return deleted;
    });
    zrangebyscore = vi.fn(
      async (
        key: string,
        min: number,
        _max: string,
        _limit: string,
        offset: number,
        count: number,
      ) =>
        [...(redisZsets.get(key) ?? [])]
          .filter(([, score]) => score >= Number(min))
          .sort((left, right) => left[1] - right[1])
          .slice(offset, offset + count)
          .map(([member]) => member),
    );
    scan = vi.fn(async (_cursor: string, _matchFlag: string, pattern: string) => {
      const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
      const matches = [...new Set([...redisData.keys(), ...redisZsets.keys()])].filter((key) =>
        pattern.endsWith("*") ? key.startsWith(prefix) : key === pattern,
      );
      return ["0", matches];
    });
    connect = vi.fn(async () => {});
    quit = vi.fn(async () => {});
    disconnect = vi.fn();

    private messageHandler?: (channel: string, message: string) => void;

    emitMessage(channel: string, message: string): void {
      this.messageHandler?.(channel, message);
    }
  },
}));

import { MemoryStore } from "@originloom/core/cache/memory";
import { RedisStore } from "@originloom/core/cache/redis";
import { TieredStore } from "@originloom/core/cache/tiered";

describe("TieredStore", () => {
  afterEach(() => {
    redisData.clear();
    redisZsets.clear();
    published.length = 0;
    vi.useRealTimers();
  });

  it("returns L1 hits without touching L2", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    const client = l2.getClient();
    await l1.write("home", "<html>l1</html>", { kind: "shared", ttl: 60, key: ["home"] });

    const store = new TieredStore({ l1, l2 });
    const hit = await store.read("home");

    expect(hit?.body).toBe("<html>l1</html>");
    expect(client.getBuffer).not.toHaveBeenCalled();
  });

  it("promotes L2 hits into L1 with preserved deadlines", async () => {
    vi.useFakeTimers();
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    await l2.write("home", "<html>l2</html>", { kind: "shared", ttl: 10, swr: 20, key: ["home"] });

    const store = new TieredStore({ l1, l2 });
    const first = await store.read("home");
    expect(first?.state).toBe("fresh");

    vi.advanceTimersByTime(11_000);
    const l1Only = await l1.read("home");
    expect(l1Only?.state).toBe("stale");
  });

  it("returns an L2 hit without bypassing L1 byte admission on promotion", async () => {
    const maxBytes = 300;
    const l1 = new MemoryStore(10, {
      maxBytes,
      namespaces: {
        page: { maxBytes, reserveBytes: 0 },
        data: { maxBytes, reserveBytes: 0 },
        fragment: { maxBytes, reserveBytes: 0 },
        negative: { maxBytes, reserveBytes: 0 },
      },
      auxiliary: { maxLocks: 10, maxEphemeralValues: 10, maxRateLimits: 10 },
    });
    const l2 = new RedisStore("redis://localhost:6379");
    await l2.write("large", `<html>${"x".repeat(300)}</html>`, {
      kind: "shared",
      ttl: 60,
      key: ["large"],
    });
    vi.mocked(l2.getClient().getBuffer).mockClear();
    const store = new TieredStore({ l1, l2 });

    expect((await store.read("large"))?.body).toContain("xxx");
    expect(await l1.read("large")).toBeNull();
    expect((await store.read("large"))?.body).toContain("xxx");
    expect(l2.getClient().getBuffer).toHaveBeenCalledTimes(2);
  });

  it("write-through updates both layers", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    const store = new TieredStore({ l1, l2 });

    await store.write("home", "<html>both</html>", { kind: "shared", ttl: 60, key: ["home"] });

    expect(await l1.read("home")).not.toBeNull();
    expect(await l2.read("home")).not.toBeNull();
  });

  it("rejects a tagged write in both tiers when the Redis tag index is full", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    vi.mocked(l2.getClient().eval).mockResolvedValueOnce(0);
    const store = new TieredStore({ l1, l2 });

    await expect(
      store.write("page:home", "<html></html>", {
        kind: "shared",
        ttl: 60,
        key: ["page:home"],
        tags: ["resource:menu"],
      }),
    ).resolves.toBe(false);
    expect(await l1.read("page:home")).toBeNull();
    expect(await l2.read("page:home")).toBeNull();
  });

  it("continues with L1 when L2 read fails", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    await l1.write("home", "<html>l1</html>", { kind: "shared", ttl: 60, key: ["home"] });
    const client = l2.getClient();
    vi.mocked(client.getBuffer).mockRejectedValueOnce(new Error("redis down"));

    const store = new TieredStore({ l1, l2 });
    const hit = await store.read("home");
    expect(hit?.body).toBe("<html>l1</html>");
  });

  it("works without L2 configured", async () => {
    const l1 = new MemoryStore(10);
    const store = new TieredStore({ l1, l2: null });
    await store.write("home", "<html>solo</html>", { kind: "shared", ttl: 60, key: ["home"] });
    expect(await store.read("home")).toEqual({
      body: "<html>solo</html>",
      state: "fresh",
      hasFragments: false,
      fragmentMarkers: [],
    });
    expect(store.ping()).resolves.toBe(true);
  });

  it("publishes an invalidation after write so other pods drop their stale L1 copy", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    const invalidation = {
      publishKey: vi.fn(async () => {}),
      publishKeys: vi.fn(async () => {}),
      publishPrefix: vi.fn(async () => {}),
      publishTags: vi.fn(async () => {}),
      publishFlushAll: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const store = new TieredStore({ l1, l2, invalidation });

    await store.write("home", "<html>fresh</html>", { kind: "shared", ttl: 60, key: ["home"] });

    expect(invalidation.publishKey).toHaveBeenCalledWith("home");
  });

  it("returns the exact union count when deleteKeys spans keys unique to each tier", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    await l1.write("only-l1", "<html>", { kind: "shared", ttl: 60, key: ["only-l1"] });
    await l2.write("only-l2", "<html>", { kind: "shared", ttl: 60, key: ["only-l2"] });

    const store = new TieredStore({ l1, l2 });
    const deleted = await store.deleteKeys(["only-l1", "only-l2", "missing"]);

    expect(deleted).toBe(2);
  });

  it("returns the exact union count when deleteByPrefix spans keys unique to each tier", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    await l1.write("menu:only-l1", "{}", { kind: "shared", ttl: 60, key: ["menu:only-l1"] });
    await l2.write("menu:only-l2", "{}", { kind: "shared", ttl: 60, key: ["menu:only-l2"] });

    const store = new TieredStore({ l1, l2 });
    const deleted = await store.deleteByPrefix("menu:");

    expect(deleted).toBe(2);
  });

  it("returns the same tag invalidation result across L1 and Redis L2", async () => {
    const l1 = new MemoryStore(20);
    const l2 = new RedisStore("redis://localhost:6379", "release-a");
    const invalidation = {
      publishKey: vi.fn(async () => {}),
      publishKeys: vi.fn(async () => {}),
      publishPrefix: vi.fn(async () => {}),
      publishTags: vi.fn(async () => {}),
      publishFlushAll: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const store = new TieredStore({ l1, l2, invalidation });
    const tagged: CachePolicy = {
      kind: "shared",
      ttl: 60,
      key: ["menu"],
      tags: ["resource:menu"],
    };

    await store.write("page:home", "<html></html>", tagged, { namespace: "page" });
    await store.write("fragment:header", "<header></header>", tagged, {
      namespace: "fragment",
    });
    await store.write("data:rates", "{}", {
      kind: "shared",
      ttl: 60,
      key: ["rates"],
      tags: ["resource:rates"],
    });

    expect(await store.deleteByTags(["resource:menu"], 500)).toEqual({
      keys: ["page:home", "fragment:header"],
      truncated: false,
    });
    expect(await l1.read("data:rates")).not.toBeNull();
    expect(await l2.read("data:rates")).not.toBeNull();
    expect(invalidation.publishTags).toHaveBeenCalledWith(["resource:menu"]);
  });

  it("isolates tag indices by release namespace during rolling deployments", async () => {
    const releaseA = new RedisStore("redis://localhost:6379", "release-a");
    const releaseB = new RedisStore("redis://localhost:6379", "release-b");
    const policy: CachePolicy = {
      kind: "shared",
      ttl: 60,
      key: ["menu"],
      tags: ["resource:menu"],
    };
    await releaseA.write("page:home", "release-a", policy);
    await releaseB.write("page:home", "release-b", policy);

    expect(await releaseA.deleteByTags(["resource:menu"], 500)).toEqual({
      keys: ["page:home"],
      truncated: false,
    });
    expect(await releaseA.read("page:home")).toBeNull();
    expect((await releaseB.read("page:home"))?.body).toBe("release-b");
  });

  it("atomically replaces Redis tag associations when a key dependency changes", async () => {
    const l2 = new RedisStore("redis://localhost:6379", "release-a");
    await l2.write("resource:shared", "menu", {
      kind: "shared",
      ttl: 60,
      key: ["resource:shared"],
      tags: ["resource:menu"],
    });
    await l2.write("resource:shared", "rates", {
      kind: "shared",
      ttl: 60,
      key: ["resource:shared"],
      tags: ["resource:rates"],
    });

    expect(await l2.keysByTags(["resource:menu"], 500)).toEqual({
      keys: [],
      truncated: false,
    });
    expect(await l2.keysByTags(["resource:rates"], 500)).toEqual({
      keys: ["resource:shared"],
      truncated: false,
    });
  });

  it("returns the exact union count when flushAll spans keys unique to each tier", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    await l1.write("only-l1", "<html>", { kind: "shared", ttl: 60, key: ["only-l1"] });
    await l2.write("only-l2", "<html>", { kind: "shared", ttl: 60, key: ["only-l2"] });

    const store = new TieredStore({ l1, l2 });
    const deleted = await store.flushAll();

    expect(deleted).toBe(2);
  });
});
