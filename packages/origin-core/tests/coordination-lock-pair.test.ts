import { afterEach, describe, expect, it } from "vitest";

import {
  attemptCoordinationLock,
  closeCache,
  initCache,
  registerCacheDriver,
  releaseAttemptedCoordinationLock,
} from "../src/cache/index.js";
import { MemoryStore } from "../src/cache/memory.js";
import type { CacheStore } from "../src/cache/types.js";

/**
 * The two halves of a lock have to come from the same store method pair.
 *
 * They do not share a key space: the Redis store keeps coordination locks
 * outside the release namespace and cache locks inside it. Choosing each half
 * on its own — `acquireCoordinationLock ?? acquireLock`, then
 * `releaseCoordinationLock ?? releaseLock` — lets a store that implements only
 * the acquire half take the lock in one namespace and release in the other.
 * Nothing throws. The lock simply stays held until its TTL expires, and every
 * submission carrying that key is refused until it does.
 */
describe("coordination lock halves", () => {
  afterEach(async () => {
    await closeCache();
    registerCacheDriver(null);
  });

  async function withStore(store: CacheStore) {
    await closeCache();
    registerCacheDriver({ name: "half-implemented", create: () => store });
    await initCache();
  }

  it("releases what it took, for a store offering only the acquire half", async () => {
    const store: CacheStore = new MemoryStore(16);
    // Exactly the shape that used to strand the lock: a dedicated acquire with
    // no dedicated release beside it.
    delete (store as { releaseCoordinationLock?: unknown }).releaseCoordinationLock;
    await withStore(store);

    const first = await attemptCoordinationLock("submission-1", 60_000);
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    await releaseAttemptedCoordinationLock("submission-1", first.token);

    expect((await attemptCoordinationLock("submission-1", 60_000)).kind).toBe("acquired");
  });

  it("still excludes a second holder while the first has it", async () => {
    await withStore(new MemoryStore(16));

    const first = await attemptCoordinationLock("submission-2", 60_000);
    const second = await attemptCoordinationLock("submission-2", 60_000);

    expect(first.kind).toBe("acquired");
    expect(second.kind).toBe("held");
  });
});
