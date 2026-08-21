import { dynamicHtmlPlaceholders } from "@originloom/core/cache/dynamic-html";
import {
  type CacheNamespace,
  type L1MemoryOptions,
  MemoryStore,
} from "@originloom/core/cache/memory";
import { renderMetrics } from "@originloom/core/metrics";
import type { CachePolicy } from "@originloom/shared/lib/types";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("MemoryStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and reads fresh entries", async () => {
    const store = new MemoryStore(10);
    await store.write("k", "<html>ok</html>", { kind: "shared", ttl: 60, key: ["k"] });
    const hit = await store.read("k");
    expect(hit?.state).toBe("fresh");
    expect(hit?.body).toBe("<html>ok</html>");
  });

  it("preserves dynamic HTML slots byte-for-byte", async () => {
    const store = new MemoryStore(10);
    const slots = dynamicHtmlPlaceholders();
    const body =
      `<html><script nonce="${slots.cspNonce}">run()</script>` +
      `<script>{"pageRequestId":"${slots.pageRequestId}"}</script></html>`;

    await store.write("dynamic", body, { kind: "shared", ttl: 60, key: ["dynamic"] });

    expect((await store.read("dynamic"))?.body).toBe(body);
  });

  it("returns stale after fresh window expires", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore(10);
    await store.write("k", "<html>ok</html>", { kind: "shared", ttl: 1, swr: 5, key: ["k"] });

    vi.advanceTimersByTime(1_500);
    const hit = await store.read("k");
    expect(hit?.state).toBe("stale");
  });

  it("evicts entries after stale window expires", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore(10);
    await store.write("k", "<html>ok</html>", { kind: "shared", ttl: 1, swr: 1, key: ["k"] });

    vi.advanceTimersByTime(2_500);
    expect(await store.read("k")).toBeNull();
  });

  it("ignores write when policy is none", async () => {
    const store = new MemoryStore(10);
    await store.write("k", "<html>ok</html>", { kind: "none" });
    expect(await store.read("k")).toBeNull();
  });

  it("deletes keys and prefixes", async () => {
    const store = new MemoryStore(10);
    await store.write("menu:Desktop", "{}", { kind: "shared", ttl: 60, key: ["menu:Desktop"] });
    await store.write("menu:Mobile", "{}", { kind: "shared", ttl: 60, key: ["menu:Mobile"] });
    await store.write("home\0tr", "<html>", { kind: "shared", ttl: 60, key: ["home", "tr"] });

    expect(await store.deleteKeys(["menu:Desktop"])).toBe(1);
    expect(await store.deleteByPrefix("menu:")).toBe(1);
    expect(await store.read("home\0tr")).not.toBeNull();

    expect(await store.flushAll()).toBe(1);
    expect(await store.read("home\0tr")).toBeNull();
  });

  it("invalidates the bounded union of dependency tags without touching unrelated entries", async () => {
    const store = new MemoryStore(20);
    const menuPolicy: CachePolicy = {
      kind: "shared",
      ttl: 60,
      key: ["menu"],
      tags: ["resource:menu"],
    };
    await store.write("page:home", "<html>page</html>", menuPolicy, { namespace: "page" });
    await store.write("fragment:header", "<header></header>", menuPolicy, {
      namespace: "fragment",
    });
    await store.write("data:rates", "{}", {
      kind: "shared",
      ttl: 60,
      key: ["rates"],
      tags: ["resource:rates"],
    });

    expect(await store.keysByTags(["resource:menu"], 10)).toEqual({
      keys: ["page:home", "fragment:header"],
      truncated: false,
    });
    expect(await store.deleteByTags(["resource:menu"], 10)).toEqual({
      keys: ["page:home", "fragment:header"],
      truncated: false,
    });
    expect(await store.read("data:rates")).not.toBeNull();
    expect(await store.keysByTags(["resource:menu"], 10)).toEqual({ keys: [], truncated: false });
  });

  it("bounds tag purge work and reports truncation", async () => {
    const store = new MemoryStore(20);
    for (let index = 0; index < 5; index++) {
      await store.write(`tagged:${index}`, "x", {
        kind: "shared",
        ttl: 60,
        key: [String(index)],
        tags: ["resource:menu"],
      });
    }

    expect(await store.deleteByTags(["resource:menu"], 2)).toEqual({
      keys: ["tagged:0", "tagged:1"],
      truncated: true,
    });
    expect((await store.keysByTags(["resource:menu"], 10)).keys).toHaveLength(3);
  });

  it("rejects entries that would exceed per-tag cardinality", async () => {
    const store = new MemoryStore(600, memoryOptions(2_000_000));
    for (let index = 0; index < 500; index++) {
      await expect(
        store.write(`menu:${index}`, "x", {
          kind: "shared",
          ttl: 60,
          key: [String(index)],
          tags: ["resource:menu"],
        }),
      ).resolves.toBe(true);
    }

    await expect(
      store.write("menu:overflow", "x", {
        kind: "shared",
        ttl: 60,
        key: ["overflow"],
        tags: ["resource:menu"],
      }),
    ).resolves.toBe(false);
    expect((await store.keysByTags(["resource:menu"], 500)).keys).toHaveLength(500);
  });

  it("lists keys with cursor", async () => {
    const store = new MemoryStore(10);
    await store.write("a", "1", { kind: "shared", ttl: 60, key: ["a"] });
    await store.write("ab", "2", { kind: "shared", ttl: 60, key: ["ab"] });
    await store.write("b", "3", { kind: "shared", ttl: 60, key: ["b"] });

    const first = await store.listKeys({ prefix: "a", limit: 1 });
    expect(first.keys).toEqual(["a"]);
    expect(first.nextCursor).toBe("1");

    const second = await store.listKeys({
      prefix: "a",
      limit: 1,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(second.keys).toEqual(["ab"]);
  });

  it("rejects a single entry that exceeds the global byte limit", async () => {
    const store = new MemoryStore(10, memoryOptions(300));

    await expect(
      store.write("large", "x".repeat(200), { kind: "shared", ttl: 60, key: ["large"] }),
    ).resolves.toBe(false);
    expect(store.currentBytes).toBe(0);
    expect(store.size).toBe(0);
  });

  it("protects namespace reserves while allowing unused capacity to be borrowed", async () => {
    const store = new MemoryStore(
      10,
      memoryOptions(1_100, {
        page: { maxBytes: 1_100, reserveBytes: 350 },
        data: { maxBytes: 1_100, reserveBytes: 350 },
      }),
    );
    const policy: CachePolicy = { kind: "shared", ttl: 60, key: ["entry"] };

    await store.write("page", "p".repeat(210), policy, { namespace: "page" });
    await store.write("data-old", "d".repeat(210), policy, { namespace: "data" });
    await store.write("data-new", "n".repeat(210), policy, { namespace: "data" });

    expect(await store.read("page")).not.toBeNull();
    expect(await store.read("data-old")).toBeNull();
    expect(await store.read("data-new")).not.toBeNull();
    expect(store.currentBytes).toBeLessThanOrEqual(1_100);
  });

  it("updates recency on hit and evicts the least-recently-used entry", async () => {
    const store = new MemoryStore(2, memoryOptions(10_000));
    const policy: CachePolicy = { kind: "shared", ttl: 60, key: ["entry"] };
    await store.write("a", "1", policy, { namespace: "data" });
    await store.write("b", "2", policy, { namespace: "data" });

    await store.read("a");
    await store.write("c", "3", policy, { namespace: "data" });

    expect(await store.read("a")).not.toBeNull();
    expect(await store.read("b")).toBeNull();
    expect(await store.read("c")).not.toBeNull();
  });

  it("counts typed resource values in admission without losing the serialized fallback", async () => {
    const store = new MemoryStore(10, memoryOptions(500));
    const policy: CachePolicy = { kind: "shared", ttl: 60, key: ["resource"] };
    await store.write("resource", '{"value":1}', policy, { namespace: "data" });

    await expect(store.attachMemoryValue("resource", { value: 1 }, 400, "data")).resolves.toBe(
      false,
    );
    const hit = await store.read("resource");
    expect(hit?.body).toBe('{"value":1}');
    expect(hit).not.toHaveProperty("memoryValue");
    expect(store.currentBytes).toBeLessThanOrEqual(500);
  });

  it("cleans expired cache and auxiliary records without subsequent traffic", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore(
      10,
      memoryOptions(10_000, undefined, {
        maxLocks: 1,
        maxEphemeralValues: 1,
        maxRateLimits: 1,
      }),
    );
    await store.write("page", "<html></html>", { kind: "shared", ttl: 1, key: ["page"] });
    await store.acquireLock("lock", 1_000);
    await store.writeEphemeral("value", "ok", 1_000);
    await store.takeRateLimit("rate", 1, 1_000);

    expect(store.auxiliarySizes()).toEqual({ locks: 1, ephemeralValues: 1, rateLimits: 1 });
    vi.advanceTimersByTime(1_001);

    expect(store.size).toBe(0);
    expect(store.auxiliarySizes()).toEqual({ locks: 0, ephemeralValues: 0, rateLimits: 0 });
  });

  it("keeps all auxiliary maps bounded at their configured limits", async () => {
    const store = new MemoryStore(
      10,
      memoryOptions(10_000, undefined, {
        maxLocks: 1,
        maxEphemeralValues: 1,
        maxRateLimits: 1,
      }),
    );

    expect(await store.acquireLock("first", 60_000)).not.toBeNull();
    expect(await store.acquireLock("second", 60_000)).toBeNull();
    await store.writeEphemeral("first", "1", 60_000);
    await store.writeEphemeral("second", "2", 60_000);
    await store.takeRateLimit("first", 10, 60_000);
    await expect(store.takeRateLimit("second", 10, 60_000)).resolves.toEqual({
      allowed: false,
      retryAfterMs: 60_000,
    });

    expect(await store.readEphemeral("first")).toBeNull();
    expect(await store.readEphemeral("second")).toBe("2");
    expect(store.auxiliarySizes()).toEqual({ locks: 1, ephemeralValues: 1, rateLimits: 1 });
  });

  it("exports namespace byte, entry, eviction and rejection metrics", async () => {
    const store = new MemoryStore(1, memoryOptions(450));
    const policy: CachePolicy = { kind: "shared", ttl: 60, key: ["entry"] };
    await store.write("first", "1", policy, { namespace: "data" });
    await store.write("second", "2", policy, { namespace: "data" });
    await store.write("oversized", "x".repeat(500), policy, { namespace: "negative" });

    const metrics = renderMetrics();
    expect(metrics).toMatch(/ssr_l1_cache_current_bytes\{namespace="data"\} [1-9]\d*/);
    expect(metrics).toContain('ssr_l1_cache_entries{namespace="data"} 1');
    expect(metrics).toContain(
      'ssr_l1_cache_evictions_total{namespace="data",reason="entry_limit"}',
    );
    expect(metrics).toContain(
      'ssr_l1_cache_rejections_total{namespace="negative",reason="entry_too_large"}',
    );
  });
});

function memoryOptions(
  maxBytes: number,
  overrides?: Partial<Record<CacheNamespace, { maxBytes: number; reserveBytes: number }>>,
  auxiliary: L1MemoryOptions["auxiliary"] = {
    maxLocks: 100,
    maxEphemeralValues: 100,
    maxRateLimits: 100,
  },
): L1MemoryOptions {
  const unlimited = { maxBytes, reserveBytes: 0 };
  return {
    maxBytes,
    namespaces: {
      page: overrides?.page ?? unlimited,
      data: overrides?.data ?? unlimited,
      fragment: overrides?.fragment ?? unlimited,
      negative: overrides?.negative ?? unlimited,
    },
    auxiliary,
  };
}
