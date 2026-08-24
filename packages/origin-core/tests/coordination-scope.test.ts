import { afterEach, describe, expect, it } from "vitest";

import {
  closeCache,
  initCache,
  isCoordinationShared,
  registerCacheDriver,
} from "../src/cache/index.js";
import { MemoryStore } from "../src/cache/memory.js";

/**
 * The question a cross-pod guarantee rests on, asked of the only party that can
 * answer it.
 *
 * It used to be asked of the wrong thing: "is a driver registered?" — which a
 * test double, a filesystem store and a Redis client all answer yes to. A guard
 * that believes it is site-wide because *some* driver exists goes quiet during
 * exactly the deployment where it is not.
 */
describe("isCoordinationShared", () => {
  afterEach(async () => {
    await closeCache();
    registerCacheDriver(null);
  });

  it("does not take a driver's word it never gave", async () => {
    registerCacheDriver({ name: "test-double", create: () => new MemoryStore(16) });
    await initCache();

    expect(isCoordinationShared()).toBe(false);
  });

  it("takes it when the driver declares it", async () => {
    registerCacheDriver({
      name: "shared-double",
      coordinationScope: "shared",
      create: () => new MemoryStore(16),
    });
    await initCache();

    expect(isCoordinationShared()).toBe(true);
  });

  /** No driver, no L2: the default topology, and it is not shared. */
  it("is false for the built-in memory topology", async () => {
    await initCache();

    expect(isCoordinationShared()).toBe(false);
  });
});
