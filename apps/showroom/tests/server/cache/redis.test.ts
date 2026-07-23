import { beforeEach, describe, expect, it, vi } from "vitest";

const redisData = new Map<string, Buffer>();

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

vi.mock("ioredis", () => ({
  default: class RedisMock {
    status = "ready";
    get = vi.fn(async (key: string) => redisData.get(key)?.toString("utf8") ?? null);
    getBuffer = vi.fn(async (key: string) => redisData.get(key) ?? null);
    set = vi.fn(async (key: string, value: string | Buffer, ...args: unknown[]) => {
      if (args.includes("NX") && redisData.has(key)) return null;
      redisData.set(key, toBuffer(value));
      return "OK";
    });
    del = vi.fn(async (key: string) => {
      redisData.delete(key);
    });
    ping = vi.fn(async () => "PONG");
    eval = vi.fn(async (_script: string, _keyCount: number, key: string, token: string) => {
      if (redisData.get(key)?.toString("utf8") !== token) return 0;
      redisData.delete(key);
      return 1;
    });
    connect = vi.fn(async () => {});
    quit = vi.fn(async () => {});
    on = vi.fn();
  },
}));

import { RedisStore } from "@originloom/core/cache/redis";

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
    redisData.set("ssr:development:broken", Buffer.from("not-a-valid-cache-entry", "utf8"));
    const store = new RedisStore("redis://localhost:6379");
    await expect(store.read("broken")).resolves.toBeNull();
    expect(redisData.has("ssr:development:broken")).toBe(false);
  });

  it("keeps serving legacy JSON entries until their existing TTL expires", async () => {
    const legacy = {
      body: "<!DOCTYPE html><p>legacy</p>",
      freshUntil: Date.now() + 60_000,
      staleUntil: Date.now() + 120_000,
    };
    redisData.set("ssr:development:legacy", Buffer.from(JSON.stringify(legacy), "utf8"));
    const store = new RedisStore("redis://localhost:6379");

    await expect(store.read("legacy")).resolves.toEqual({
      body: legacy.body,
      state: "fresh",
    });
    expect(redisData.has("ssr:development:legacy")).toBe(true);
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
