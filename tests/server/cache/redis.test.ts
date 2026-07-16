import { beforeEach, describe, expect, it, vi } from "vitest";

const redisData = new Map<string, string>();

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    status: "ready",
    get: vi.fn(async (key: string) => redisData.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      redisData.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      redisData.delete(key);
    }),
    ping: vi.fn(async () => "PONG"),
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
});
