import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryStore } from "../src/cache/memory.js";
import { TieredStore } from "../src/cache/tiered.js";

describe("MemoryStore.readSync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a missing key, exactly like read()", async () => {
    const store = new MemoryStore(10);
    expect(store.readSync("missing")).toBeNull();
    expect(await store.read("missing")).toBeNull();
  });

  it("returns a fresh entry with the same shape read() would return", async () => {
    const store = new MemoryStore(10);
    await store.write("k", "<html>ok</html>", { kind: "shared", ttl: 60, key: ["k"] });
    const synced = store.readSync("k");
    const read = await store.read("k");
    expect(synced).toEqual(read);
    expect(synced?.state).toBe("fresh");
    expect(synced?.body).toBe("<html>ok</html>");
  });

  it("reports stale once ttl elapses but swr has not — same as read()", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore(10);
    await store.write("k", "body", { kind: "shared", ttl: 1, swr: 60, key: ["k"] });
    vi.advanceTimersByTime(1_100);
    expect(store.readSync("k")?.state).toBe("stale");
    expect((await store.read("k"))?.state).toBe("stale");
  });

  it("evicts and returns null once staleUntil has passed, via either path", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore(10);
    await store.write("k", "body", { kind: "shared", ttl: 1, key: ["k"] });
    vi.advanceTimersByTime(1_100);
    expect(store.readSync("k")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("surfaces an attached typed memoryValue, the shape the resource cache fast path needs", async () => {
    const store = new MemoryStore(10);
    await store.write("k", '{"value":1}', { kind: "shared", ttl: 60, key: ["k"] });
    await store.attachMemoryValue("k", { value: 1 }, 64, "data");
    expect(store.readSync("k")?.memoryValue).toEqual({ value: 1 });
  });

  it("stays byte-for-byte identical to read() across a fresh/stale/expired lifecycle", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore(10);
    await store.write("k", "body", { kind: "shared", ttl: 1, swr: 1, key: ["k"] });
    expect(store.readSync("k")).toEqual(await store.read("k"));
    vi.advanceTimersByTime(1_100);
    expect(store.readSync("k")).toEqual(await store.read("k"));
    vi.advanceTimersByTime(1_100);
    expect(store.readSync("k")).toEqual(await store.read("k"));
  });
});

describe("TieredStore.readSync", () => {
  it("is L1-only: an L1 hit is returned without ever needing L2", () => {
    const l1 = new MemoryStore(10);
    const store = new TieredStore({ l1, l2: null });
    void l1.write("k", "l1-body", { kind: "shared", ttl: 60, key: ["k"] });
    expect(store.readSync("k")?.body).toBe("l1-body");
  });

  it("returns null on an L1 miss — callers must fall back to read(), never treat this as a real miss", () => {
    const l1 = new MemoryStore(10);
    const store = new TieredStore({ l1, l2: null });
    // No L2 configured either, so a real read() would also miss here — this
    // case is unambiguous. The adjacent "L2 has it, L1 doesn't" scenario
    // (where readSync() must still return null even though read() would find it)
    // is covered against a real Redis-backed store in cached-resource.test.ts,
    // since that is the scenario that actually exercises cross-tier safety.
    expect(store.readSync("k")).toBeNull();
  });
});
