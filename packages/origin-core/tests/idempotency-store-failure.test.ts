import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeCache, initCache, registerCacheDriver } from "../src/cache/index.js";
import { MemoryStore } from "../src/cache/memory.js";
import type { CacheStore } from "../src/cache/types.js";
import { newIdempotencyKey, runOnce } from "../src/idempotency.js";

type Receipt = { id: number };

/** A store whose lock is the thing that fails — a Redis nobody can reach. */
function storeWithFailingLock(): CacheStore {
  const store = new MemoryStore(16);
  store.acquireCoordinationLock = () => Promise.reject(new Error("ECONNREFUSED"));
  store.acquireLock = () => Promise.reject(new Error("ECONNREFUSED"));
  store.readEphemeral = () => Promise.reject(new Error("ECONNREFUSED"));
  store.writeEphemeral = () => Promise.reject(new Error("ECONNREFUSED"));
  return store;
}

/**
 * "Nobody could answer" is not "someone else is doing it".
 *
 * Both used to arrive as `null` from the lock and both came out as `in-flight`,
 * which is the worst of the three answers during an outage: the caller tells a
 * visitor their submission is already being handled while nothing is handling
 * it, and `ssr_idempotent_runs_total{outcome="unavailable"}` — the series an
 * alarm watches — stays flat through the exact failure it was built for.
 */
describe("runOnce when the coordination store is down", () => {
  beforeEach(async () => {
    await closeCache();
    registerCacheDriver({ name: "unreachable", create: storeWithFailingLock });
    await initCache();
  });

  afterEach(async () => {
    await closeCache();
    registerCacheDriver(null);
    vi.restoreAllMocks();
  });

  it("says unavailable, and still does the work", async () => {
    let calls = 0;

    const result = await runOnce<Receipt>({
      namespace: "newsletter",
      key: newIdempotencyKey(),
      work: async () => ({ id: ++calls }),
      serialize: (value) => JSON.stringify(value),
      parse: (raw) => JSON.parse(raw) as Receipt,
    });

    expect(result).toEqual({ kind: "unavailable", value: { id: 1 } });
    expect(calls).toBe(1);
  });
});
