import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    del = vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) if (redisData.delete(key)) deleted++;
      return deleted;
    });
    pipeline = vi.fn(() => {
      const operations: Array<() => [null, number]> = [];
      const pipeline = {
        del: (key: string) => {
          operations.push(() => [null, redisData.delete(key) ? 1 : 0]);
          return pipeline;
        },
        exec: async () => operations.map((operation) => operation()),
      };
      return pipeline;
    });
    eval = vi.fn(async (_script: string, _count: number, key: string, token: string) => {
      if (redisData.get(key)?.toString("utf8") !== token) return 0;
      redisData.delete(key);
      return 1;
    });
    scan = vi.fn(async (_cursor: string, _match: string, pattern: string) => {
      const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
      return [
        "0",
        [...redisData.keys()].filter((key) =>
          pattern.endsWith("*") ? key.startsWith(prefix) : key === pattern,
        ),
      ];
    });
    ping = vi.fn(async () => "PONG");
    publish = vi.fn(async () => 1);
    subscribe = vi.fn(async () => undefined);
    duplicate = vi.fn(() => new RedisMock());
    connect = vi.fn(async () => undefined);
    quit = vi.fn(async () => undefined);
    disconnect = vi.fn();
    on = vi.fn();
  },
}));

import { closeCache, initCache, invalidateTags, write } from "../src/cache/index.js";
import {
  cachedResourceNoContent,
  cachedResourceNotFound,
  cachedResourceValue,
  defineCachedResource,
  drainCachedResourceRevalidations,
} from "../src/cache/resource.js";
import { renderMetrics } from "../src/metrics.js";

const originalBackend = process.env.CACHE_BACKEND;
const originalRedisUrl = process.env.REDIS_URL;

type Snapshot = { value: number };

function parseSnapshot(value: unknown): Snapshot {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).value !== "number"
  ) {
    throw new Error("invalid snapshot");
  }
  return Object.freeze({ value: (value as { value: number }).value });
}

async function useBackend(backend: "memory" | "redis"): Promise<void> {
  process.env.CACHE_BACKEND = backend;
  process.env.REDIS_URL = backend === "redis" ? "redis://localhost:6379" : "";
  await closeCache();
  await initCache();
}

describe("typed cached resources", () => {
  beforeEach(async () => {
    redisData.clear();
    await useBackend("memory");
  });

  afterEach(async () => {
    await drainCachedResourceRevalidations(1_000);
    await closeCache();
    vi.useRealTimers();
  });

  afterAll(() => {
    if (originalBackend === undefined) delete process.env.CACHE_BACKEND;
    else process.env.CACHE_BACKEND = originalBackend;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  it.each(["memory", "redis"] as const)(
    "exposes the same fresh/stale/refresh contract with the %s backend",
    async (backend) => {
      await useBackend(backend);
      vi.useFakeTimers();
      let loads = 0;
      const resource = defineCachedResource<Snapshot>({
        namespace: `contract-${backend}`,
        version: 1,
        ttl: 1,
        swr: 10,
        parse: parseSnapshot,
      });
      const load = async () => cachedResourceValue({ value: ++loads });

      await expect(resource.get(["main"], load)).resolves.toEqual({
        kind: "value",
        value: { value: 1 },
        cacheState: "miss",
      });
      const firstValue = await resource.get(["main"], load);
      expect(firstValue).toMatchObject({ kind: "value", value: { value: 1 }, cacheState: "fresh" });
      expect(loads).toBe(1);

      if (backend === "redis") {
        await closeCache();
        await initCache();
        await expect(resource.get(["main"], load)).resolves.toMatchObject({
          kind: "value",
          value: { value: 1 },
          cacheState: "fresh",
        });
        expect(loads).toBe(1);
      }

      vi.advanceTimersByTime(1_100);
      await expect(resource.get(["main"], load)).resolves.toMatchObject({
        kind: "value",
        value: { value: 1 },
        cacheState: "stale",
      });
      await expect(drainCachedResourceRevalidations(1_000)).resolves.toBe(true);
      await expect(resource.get(["main"], load)).resolves.toMatchObject({
        kind: "value",
        value: { value: 2 },
        cacheState: "fresh",
      });
      expect(loads).toBe(2);
    },
  );

  it("coalesces a concurrent cold burst into one loader call", async () => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "cold-burst",
      version: 1,
      ttl: 60,
      parse: parseSnapshot,
    });
    let release!: (value: ReturnType<typeof cachedResourceValue<Snapshot>>) => void;
    const gate = new Promise<ReturnType<typeof cachedResourceValue<Snapshot>>>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async () => gate);

    const first = resource.get([1], load);
    const second = resource.get([1], load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    release(cachedResourceValue({ value: 7 }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "value", value: { value: 7 }, cacheState: "miss" },
      { kind: "value", value: { value: 7 }, cacheState: "miss" },
    ]);
  });

  it("keeps validated values typed in L1 instead of parsing every hit", async () => {
    const parse = vi.fn(parseSnapshot);
    const resource = defineCachedResource<Snapshot>({
      namespace: "typed-l1",
      version: 1,
      ttl: 60,
      parse,
    });

    await resource.get(["x"], async () => cachedResourceValue({ value: 1 }));
    const parsesAfterFill = parse.mock.calls.length;
    await resource.get(["x"], async () => cachedResourceValue({ value: 2 }));

    expect(parsesAfterFill).toBeGreaterThan(0);
    expect(parse).toHaveBeenCalledTimes(parsesAfterFill);
  });

  it("invalidates both the typed L1 value and the serialized backend entry", async () => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "resource-invalidation",
      version: 1,
      ttl: 60,
      parse: parseSnapshot,
    });
    let value = 0;
    const load = vi.fn(async () => cachedResourceValue({ value: ++value }));

    await resource.get(["x"], load);
    await expect(resource.invalidate(["x"])).resolves.toBe(true);
    await expect(resource.get(["x"], load)).resolves.toMatchObject({
      value: { value: 2 },
      cacheState: "miss",
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("associates resource entries with stable dependency tags", async () => {
    const menu = defineCachedResource<Snapshot>({
      namespace: "tagged-menu",
      version: 1,
      ttl: 60,
      tags: ["resource:menu"],
      parse: parseSnapshot,
    });
    const rates = defineCachedResource<Snapshot>({
      namespace: "tagged-rates",
      version: 1,
      ttl: 60,
      tags: ["resource:rates"],
      parse: parseSnapshot,
    });
    const menuLoad = vi.fn(async () => cachedResourceValue({ value: 1 }));
    const ratesLoad = vi.fn(async () => cachedResourceValue({ value: 2 }));
    await menu.get(["main"], menuLoad);
    await rates.get(["main"], ratesLoad);

    await expect(invalidateTags(["resource:menu"])).resolves.toEqual({
      keys: [menu.key(["main"])],
      truncated: false,
    });
    await menu.get(["main"], menuLoad);
    await rates.get(["main"], ratesLoad);
    expect(menuLoad).toHaveBeenCalledTimes(2);
    expect(ratesLoad).toHaveBeenCalledTimes(1);
  });

  it("returns stale immediately and starts only one detached refresh", async () => {
    vi.useFakeTimers();
    const resource = defineCachedResource<Snapshot>({
      namespace: "stale-burst",
      version: 1,
      ttl: 1,
      swr: 10,
      parse: parseSnapshot,
    });
    await resource.get(["x"], async () => cachedResourceValue({ value: 1 }));
    vi.advanceTimersByTime(1_100);

    let release!: (value: ReturnType<typeof cachedResourceValue<Snapshot>>) => void;
    const gate = new Promise<ReturnType<typeof cachedResourceValue<Snapshot>>>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn(async () => gate);
    const [first, second] = await Promise.all([
      resource.get(["x"], refresh),
      resource.get(["x"], refresh),
    ]);
    expect(first).toMatchObject({ value: { value: 1 }, cacheState: "stale" });
    expect(second).toMatchObject({ value: { value: 1 }, cacheState: "stale" });
    expect(refresh).toHaveBeenCalledTimes(1);

    release(cachedResourceValue({ value: 2 }));
    await expect(drainCachedResourceRevalidations(1_000)).resolves.toBe(true);
    await expect(resource.get(["x"], refresh)).resolves.toMatchObject({
      value: { value: 2 },
      cacheState: "fresh",
    });
  });

  it("keeps shared fill work alive when the initiating request aborts", async () => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "abort-independent",
      version: 1,
      ttl: 60,
      parse: parseSnapshot,
    });
    let release!: (value: ReturnType<typeof cachedResourceValue<Snapshot>>) => void;
    const gate = new Promise<ReturnType<typeof cachedResourceValue<Snapshot>>>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      expect(signal.aborted).toBe(false);
      return gate;
    });
    const request = new AbortController();

    const abandoned = resource.get(["x"], load, { signal: request.signal });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    request.abort(new DOMException("request ended", "AbortError"));
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    release(cachedResourceValue({ value: 9 }));

    await expect(resource.get(["x"], load)).resolves.toMatchObject({
      value: { value: 9 },
      cacheState: "miss",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches explicit negative results only when their policy enables it", async () => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "negative-results",
      version: 1,
      ttl: 60,
      negativeTtl: { notFound: 10 },
      parse: parseSnapshot,
    });
    const notFound = vi.fn(async () => cachedResourceNotFound());
    const noContent = vi.fn(async () => cachedResourceNoContent());

    await expect(resource.get(["missing"], notFound)).resolves.toEqual({
      kind: "not-found",
      cacheState: "miss",
    });
    await expect(resource.get(["missing"], notFound)).resolves.toEqual({
      kind: "not-found",
      cacheState: "fresh",
    });
    expect(notFound).toHaveBeenCalledTimes(1);

    await resource.get(["empty"], noContent);
    await resource.get(["empty"], noContent);
    expect(noContent).toHaveBeenCalledTimes(2);
  });

  it("never turns loader errors into negative cache entries", async () => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "loader-errors",
      version: 1,
      ttl: 60,
      negativeTtl: 10,
      parse: parseSnapshot,
    });
    const load = vi.fn(async () => {
      throw new Error("upstream unavailable");
    });

    await expect(resource.get(["x"], load)).rejects.toThrow("upstream unavailable");
    await expect(resource.get(["x"], load)).rejects.toThrow("upstream unavailable");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("validates loader values before writing them", async () => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "loader-validation",
      version: 1,
      ttl: 60,
      parse: parseSnapshot,
    });
    const invalid = vi.fn(async () => cachedResourceValue({ value: "wrong" } as never));

    await expect(resource.get(["x"], invalid)).rejects.toMatchObject({
      name: "CachedResourceValidationError",
    });
    await expect(
      resource.get(["x"], async () => cachedResourceValue({ value: 3 })),
    ).resolves.toMatchObject({ value: { value: 3 }, cacheState: "miss" });
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it("serves an expired snapshot only when a blocking refresh fails inside stale-if-error", async () => {
    vi.useFakeTimers();
    const resource = defineCachedResource<Snapshot>({
      namespace: "stale-if-error",
      version: 1,
      ttl: 1,
      staleIfError: 10,
      parse: parseSnapshot,
    });
    await resource.get(["x"], async () => cachedResourceValue({ value: 1 }));
    vi.advanceTimersByTime(1_100);

    const fallback = await resource.get(["x"], async () => {
      throw new Error("temporary upstream error");
    });
    expect(fallback).toEqual({
      kind: "value",
      value: { value: 1 },
      cacheState: "stale",
      staleIfError: true,
    });
  });

  it.each([
    "not-json",
    JSON.stringify({
      marker: "originloom.cached-resource",
      codec: 0,
      namespace: "codec-recovery",
      version: "1",
      storedAt: Date.now(),
      result: { kind: "value", value: { value: 1 } },
    }),
  ])("deletes corrupt or old codec entries and cold-fills them", async (body) => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "codec-recovery",
      version: 1,
      ttl: 60,
      parse: parseSnapshot,
    });
    await write(resource.key(["x"]), body, { kind: "shared", ttl: 60, key: ["ignored"] });
    const load = vi.fn(async () => cachedResourceValue({ value: 2 }));

    await expect(resource.get(["x"], load)).resolves.toMatchObject({
      value: { value: 2 },
      cacheState: "miss",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("uses type-tagged deterministic keys and exports bounded resource metrics", async () => {
    const resource = defineCachedResource<Snapshot>({
      namespace: "key-contract",
      version: "v2",
      ttl: 60,
      parse: parseSnapshot,
    });
    expect(resource.key(["1", 1, true, null])).toBe(resource.key(["1", 1, true, null]));
    expect(resource.key(["1"])).not.toBe(resource.key([1]));

    await resource.get(["metric"], async () => cachedResourceValue({ value: 1 }));
    await resource.get(["metric"], async () => cachedResourceValue({ value: 2 }));
    const metrics = renderMetrics();
    expect(metrics).toContain(
      'ssr_cached_resource_access_total{resource="key-contract",state="miss",result="value"}',
    );
    expect(metrics).toContain(
      'ssr_cached_resource_access_total{resource="key-contract",state="fresh",result="value"}',
    );
    expect(metrics).toContain(
      'ssr_cached_resource_coalesced_total{resource="cold-burst",operation="fill"}',
    );
    expect(metrics).toContain(
      'ssr_cached_resource_refresh_total{resource="stale-burst",outcome="success"}',
    );
    expect(metrics).toContain(
      'ssr_cached_resource_degradation_total{resource="codec-recovery",reason="codec_version"}',
    );
  });
});
