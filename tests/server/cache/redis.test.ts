import { beforeEach, describe, expect, it, vi } from "vitest";

const redisData = new Map<string, string>();

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    status: "ready",
    get: vi.fn(async (key: string) => redisData.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && redisData.has(key)) return null;
      redisData.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      redisData.delete(key);
    }),
    ping: vi.fn(async () => "PONG"),
    eval: vi.fn(async (_script: string, _keyCount: number, key: string, token: string) => {
      if (redisData.get(key) !== token) return 0;
      redisData.delete(key);
      return 1;
    }),
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
  })),
}));

import { RedisStore } from "@server/cache/redis";

describe("RedisStore", () => {
  beforeEach(() => {
    redisData.clear();
  });

  it("stores and reads fresh entries", async () => {
    const store = new RedisStore("redis://localhost:6379");
    await store.write("loan", "<html>ok</html>", { kind: "shared", ttl: 60, key: ["loan"] });
    const hit = await store.read("loan");
    expect(hit?.state).toBe("fresh");
    expect(hit?.body).toBe("<html>ok</html>");
  });

  it("pings successfully", async () => {
    const store = new RedisStore("redis://localhost:6379");
    await expect(store.ping()).resolves.toBe(true);
  });

  it("deletes malformed entries and treats them as a miss", async () => {
    redisData.set("ssr:development:broken", "not-json");
    const store = new RedisStore("redis://localhost:6379");
    await expect(store.read("broken")).resolves.toBeNull();
    expect(redisData.has("ssr:development:broken")).toBe(false);
  });

  it("acquires a distributed NX lock and releases it only with the owner token", async () => {
    const first = new RedisStore("redis://localhost:6379");
    const second = new RedisStore("redis://localhost:6379");

    const token = await first.acquireLock("cold-fill:home", 5_000);
    expect(token).toBeTypeOf("string");
    await expect(second.acquireLock("cold-fill:home", 5_000)).resolves.toBeNull();

    await second.releaseLock("cold-fill:home", "not-the-owner");
    await expect(second.acquireLock("cold-fill:home", 5_000)).resolves.toBeNull();

    await first.releaseLock("cold-fill:home", token!);
    await expect(second.acquireLock("cold-fill:home", 5_000)).resolves.toBeTypeOf("string");
  });
});
