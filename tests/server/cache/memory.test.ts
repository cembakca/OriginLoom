import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../../server/cache/memory";

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
});
