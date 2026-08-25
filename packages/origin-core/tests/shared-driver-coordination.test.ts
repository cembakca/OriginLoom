import { afterEach, describe, expect, it } from "vitest";

import {
  attemptCoordinationLock,
  closeCache,
  initCache,
  isCoordinationShared,
  isL2Configured,
  registerCacheDriver,
} from "../src/cache/index.js";
import { MemoryStore } from "../src/cache/memory.js";

/**
 * Every single-flight path used to gate on `isL2Configured()`, which reports
 * false for *any* registered driver — the topology memo sets `l2: false` the
 * moment a driver exists, because the driver is not the platform's tiered
 * store. So an application running on a shared store the platform never heard
 * of (Cloudflare KV, Memcached, a shared Postgres) took the single-pod branch
 * on every pod: every fragment refresh, every cached-resource refill and every
 * cold miss ran everywhere at once, against the upstream the lock exists to
 * protect. Nothing failed and no metric said so.
 *
 * The guard now asks the question it meant: is coordination shared.
 */
describe("a shared driver gets cross-pod coordination", () => {
  afterEach(async () => {
    await closeCache();
    registerCacheDriver(null);
  });

  it("still reports no L2 — that is what made the old guard wrong", async () => {
    registerCacheDriver({
      name: "shared-kv",
      coordinationScope: "shared",
      create: () => new MemoryStore(16),
    });
    await initCache();

    expect(isL2Configured()).toBe(false);
    expect(isCoordinationShared()).toBe(true);
  });

  /** The lock a second pod would contend for, taken through the driver. */
  it("takes a real lock rather than a synthetic one", async () => {
    registerCacheDriver({
      name: "shared-kv",
      coordinationScope: "shared",
      create: () => new MemoryStore(16),
    });
    await initCache();

    const first = await attemptCoordinationLock("fragment-refresh:menu", 60_000);
    const second = await attemptCoordinationLock("fragment-refresh:menu", 60_000);

    expect(first.kind).toBe("acquired");
    expect(second.kind).toBe("held");
  });
});
