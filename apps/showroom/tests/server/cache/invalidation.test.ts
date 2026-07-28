import { applyInvalidationToL1, CacheInvalidationBus } from "@originloom/core/cache/invalidation";
import { MemoryStore } from "@originloom/core/cache/memory";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

let messageListenerRegisteredBeforeFirstSubscribe = false;

vi.mock("ioredis", () => ({
  default: class RedisMock {
    status = "ready";
    handlers = new Map<string, Handler[]>();
    publish = vi.fn(async () => 1);
    subscribe = vi.fn(async (_channel: string) => {
      if ((this.handlers.get("message") ?? []).length === 0) return;
      messageListenerRegisteredBeforeFirstSubscribe ||= true;
    });
    on = vi.fn((event: string, handler: Handler) => {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
    });
    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    duplicate = vi.fn(() => new RedisMock());
    quit = vi.fn(async () => {});
    disconnect = vi.fn();
  },
}));

import Redis from "ioredis";

type RedisMockInstance = InstanceType<typeof Redis> & {
  emit(event: string, ...args: unknown[]): void;
  subscribe: ReturnType<typeof vi.fn>;
};

describe("CacheInvalidationBus", () => {
  afterEach(() => {
    vi.clearAllMocks();
    messageListenerRegisteredBeforeFirstSubscribe = false;
  });

  it("clears matching L1 keys on prefix invalidation", async () => {
    const l1 = new MemoryStore(10);
    await l1.write("menu:a", "{}", { kind: "shared", ttl: 60, key: ["menu:a"] });
    await l1.write("home", "<html>", { kind: "shared", ttl: 60, key: ["home"] });

    applyInvalidationToL1(l1, { type: "prefix", prefix: "menu:" });

    expect(await l1.read("menu:a")).toBeNull();
    expect(await l1.read("home")).not.toBeNull();
  });

  it("publishes invalidation messages", async () => {
    const publisher = new Redis("redis://localhost:6379");
    const bus = new CacheInvalidationBus(publisher, "test-release", () => {});
    await bus.publishKey("home");
    expect(publisher.publish).toHaveBeenCalled();
  });

  it("registers the message listener before subscribing", async () => {
    const publisher = new Redis("redis://localhost:6379");
    const bus = new CacheInvalidationBus(publisher, "test-release", () => {});
    let subscriber: RedisMockInstance | undefined;

    await bus.startSubscriber(() => {
      subscriber = new Redis("redis://localhost:6379") as RedisMockInstance;
      return subscriber;
    });

    expect(subscriber?.subscribe).toHaveBeenCalled();
    expect(messageListenerRegisteredBeforeFirstSubscribe).toBe(true);
  });

  it("flushes L1 once after reconnecting following a lost connection, never on a bare close", async () => {
    const l1 = new MemoryStore(10);
    await l1.write("home", "<html>", { kind: "shared", ttl: 60, key: ["home"] });
    const flushSpy = vi.spyOn(l1, "flushAllSync");

    const publisher = new Redis("redis://localhost:6379");
    const bus = new CacheInvalidationBus(publisher, "test-release", (message) =>
      applyInvalidationToL1(l1, message),
    );
    let subscriber: RedisMockInstance | undefined;
    await bus.startSubscriber(() => {
      subscriber = new Redis("redis://localhost:6379") as RedisMockInstance;
      return subscriber;
    });

    // Initial connect: no prior connection was lost, so no flush.
    subscriber?.emit("ready");
    expect(flushSpy).not.toHaveBeenCalled();

    // A transient disconnect (ioredis fires "close" on every dropped
    // connection, including ones its own reconnect loop will recover from)
    // must not by itself wipe L1.
    subscriber?.emit("close");
    expect(flushSpy).not.toHaveBeenCalled();

    // Multiple close attempts before the connection actually recovers should
    // still only cost a single flush once reconnected.
    subscriber?.emit("close");
    subscriber?.emit("ready");
    expect(flushSpy).toHaveBeenCalledTimes(1);

    // A second, independent loss-and-recovery cycle flushes again.
    subscriber?.emit("close");
    subscriber?.emit("ready");
    expect(flushSpy).toHaveBeenCalledTimes(2);
  });

  it("re-subscribes on every reconnect so a failed initial subscribe self-heals", async () => {
    const publisher = new Redis("redis://localhost:6379");
    const bus = new CacheInvalidationBus(publisher, "test-release", () => {});
    let subscriber: RedisMockInstance | undefined;

    await bus.startSubscriber(() => {
      subscriber = new Redis("redis://localhost:6379") as RedisMockInstance;
      return subscriber;
    });
    expect(subscriber?.subscribe).toHaveBeenCalledTimes(1);

    subscriber?.emit("ready");
    expect(subscriber?.subscribe).toHaveBeenCalledTimes(2);
  });
});
