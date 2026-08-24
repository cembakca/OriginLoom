import { afterEach, describe, expect, it } from "vitest";

import {
  cacheTopology,
  closeCache,
  initCache,
  read,
  registerCacheDriver,
  registeredCacheDriverName,
  write,
} from "../src/cache/index.js";
import type { CacheStore } from "../src/cache/types.js";

/**
 * The smallest thing that satisfies the interface, which is the point: the
 * driver seam exists so an app on a runtime the platform has never heard of can
 * supply one without forking.
 */
function recordingStore(): CacheStore & { calls: string[] } {
  const entries = new Map<string, string>();
  const calls: string[] = [];
  return {
    calls,
    async read(key: string) {
      calls.push(`read:${key}`);
      const body = entries.get(key);
      return body === undefined ? null : { body, state: "fresh", hasFragments: false };
    },
    async write(key: string, body: string) {
      calls.push(`write:${key}`);
      entries.set(key, body);
      return true;
    },
    async deleteKey(key: string) {
      return entries.delete(key);
    },
    async deleteKeys(keys: string[]) {
      return keys.filter((key) => entries.delete(key)).length;
    },
    async deleteByPrefix() {
      return 0;
    },
    async keysByTags() {
      return { keys: [], truncated: false };
    },
    async deleteByTags() {
      return { keys: [], truncated: false };
    },
    async flushAll() {
      const size = entries.size;
      entries.clear();
      return size;
    },
    async listKeys() {
      return { keys: [], cursor: null };
    },
  } as unknown as CacheStore & { calls: string[] };
}

afterEach(async () => {
  await closeCache();
  registerCacheDriver(null);
});

describe("cache driver", () => {
  it("serves reads and writes from the registered store", async () => {
    const store = recordingStore();
    registerCacheDriver({ name: "recording", create: () => store });
    await initCache();

    await write("page:home", "<html></html>", { kind: "shared", ttl: 60, key: ["home"] });
    const hit = await read("page:home");

    expect(hit?.body).toBe("<html></html>");
    expect(store.calls).toContain("write:page:home");
  });

  it("reports the driver's own name as the topology", async () => {
    registerCacheDriver({ name: "cloudflare-kv", create: () => recordingStore() });
    await initCache();

    expect(cacheTopology()).toBe("cloudflare-kv");
    expect(registeredCacheDriverName()).toBe("cloudflare-kv");
  });

  it("accepts a driver that builds its store asynchronously", async () => {
    registerCacheDriver({
      name: "async",
      create: async () => {
        await Promise.resolve();
        return recordingStore();
      },
    });

    await expect(initCache()).resolves.toBeDefined();
  });

  /**
   * Swapping the store under a running server would leave in-flight reads on one
   * backend and their writes on another.
   */
  it("refuses to be registered once the cache is running", async () => {
    await initCache();

    expect(() => registerCacheDriver({ name: "late", create: () => recordingStore() })).toThrow(
      "before initCache()",
    );
  });

  it("falls back to the built-in tiers when no driver is registered", async () => {
    await initCache();

    expect(registeredCacheDriverName()).toBeNull();
    expect(cacheTopology()).toContain("memory");
  });
});
