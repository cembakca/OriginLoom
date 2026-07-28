import { afterEach, describe, expect, it, vi } from "vitest";

const redisData = new Map<string, Buffer>();
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
    set = vi.fn(async (key: string, value: string | Buffer, ...args: unknown[]) => {
      if (args.includes("NX") && redisData.has(key)) return null;
      redisData.set(key, toBuffer(value));
      return "OK";
    });
    del = vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (redisData.delete(key)) count++;
      }
      return count;
    });
    pipeline = vi.fn(() => {
      const ops: Array<() => [null, number]> = [];
      const chain = {
        del: (key: string) => {
          ops.push(() => [null, redisData.delete(key) ? 1 : 0]);
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
    eval = vi.fn(async (_script: string, _keyCount: number, key: string, token: string) => {
      if (redisData.get(key)?.toString("utf8") !== token) return 0;
      redisData.delete(key);
      return 1;
    });
    scan = vi.fn(async (_cursor: string, _matchFlag: string, pattern: string) => {
      const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
      const matches = [...redisData.keys()].filter((key) =>
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

  it("write-through updates both layers", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    const store = new TieredStore({ l1, l2 });

    await store.write("home", "<html>both</html>", { kind: "shared", ttl: 60, key: ["home"] });

    expect(await l1.read("home")).not.toBeNull();
    expect(await l2.read("home")).not.toBeNull();
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
    expect(await store.read("home")).toEqual({ body: "<html>solo</html>", state: "fresh" });
    expect(store.ping()).resolves.toBe(true);
  });

  it("publishes an invalidation after write so other pods drop their stale L1 copy", async () => {
    const l1 = new MemoryStore(10);
    const l2 = new RedisStore("redis://localhost:6379");
    const invalidation = {
      publishKey: vi.fn(async () => {}),
      publishKeys: vi.fn(async () => {}),
      publishPrefix: vi.fn(async () => {}),
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
