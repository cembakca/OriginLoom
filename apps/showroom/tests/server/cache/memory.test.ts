import { MemoryStore } from "@originloom/core/cache/memory";
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
});
