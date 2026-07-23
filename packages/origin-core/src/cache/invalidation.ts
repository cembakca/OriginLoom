import type Redis from "ioredis";

import { logger } from "../logger";
import type { MemoryStore } from "./memory";
import type { TieredStore } from "./tiered";

export type InvalidationMessage =
  | { type: "key"; key: string }
  | { type: "keys"; keys: string[] }
  | { type: "prefix"; prefix: string }
  | { type: "flush" };

export interface CacheInvalidationPublisher {
  publishKey(key: string): Promise<void>;
  publishKeys(keys: string[]): Promise<void>;
  publishPrefix(prefix: string): Promise<void>;
  publishFlushAll(): Promise<void>;
  close(): Promise<void>;
}

export function invalidationChannel(releaseId: string): string {
  return `ssr:${encodeURIComponent(releaseId)}:cache-invalidate`;
}

/** Redis Pub/Sub bus for cross-pod L1 invalidation. */
export class CacheInvalidationBus implements CacheInvalidationPublisher {
  private subscriber: Redis | null = null;
  private closed = false;
  private hasEverConnected = false;
  private missedMessages = false;

  constructor(
    private readonly publisher: Redis,
    private readonly releaseId: string,
    private readonly onMessage: (message: InvalidationMessage) => void,
  ) {}

  async startSubscriber(duplicate: () => Redis): Promise<void> {
    const subscriber = duplicate();
    this.subscriber = subscriber;
    const channel = invalidationChannel(this.releaseId);

    // Attach the message listener before subscribing: ioredis drops "message"
    // events with no listener registered yet, and a publish landing in the same
    // read as our own subscribe ack would otherwise be silently lost.
    subscriber.on("message", (_channel, payload) => {
      try {
        const message = JSON.parse(payload) as InvalidationMessage;
        this.onMessage(message);
      } catch (error) {
        logger.warn("cache invalidation message parse failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    subscriber.on("error", (error) => {
      logger.warn("cache invalidation subscriber error", { error: error.message });
    });

    subscriber.on("ready", () => {
      logger.info("cache invalidation subscriber connected");
      // Re-subscribe on every (re)connect: ioredis does not remember subscriptions
      // across a dropped connection, so this also recovers a failed first attempt.
      subscriber.subscribe(channel).catch((error) => {
        logger.warn("cache invalidation subscribe failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      // Only flush once we've actually lost a connection window (not on every
      // reconnect attempt) — we may have missed messages published while down.
      if (this.missedMessages) {
        logger.warn("cache invalidation subscriber reconnected after a gap; flushing local L1");
        this.onMessage({ type: "flush" });
        this.missedMessages = false;
      }
      this.hasEverConnected = true;
    });

    subscriber.on("close", () => {
      if (this.closed) return;
      logger.warn("cache invalidation subscriber disconnected");
      // ioredis emits "close" on every dropped connection, including transient
      // ones during its own automatic reconnect — only the eventual reconnect
      // (handled in the "ready" listener above) should trigger a flush.
      if (this.hasEverConnected) this.missedMessages = true;
    });

    try {
      await subscriber.subscribe(channel);
    } catch (error) {
      // Don't propagate: the "ready" handler above will retry once the
      // connection (which ioredis retries automatically) is established.
      logger.warn("cache invalidation initial subscribe failed; will retry on reconnect", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async publishKey(key: string): Promise<void> {
    await this.publish({ type: "key", key });
  }

  async publishKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.publish({ type: "keys", keys });
  }

  async publishPrefix(prefix: string): Promise<void> {
    await this.publish({ type: "prefix", prefix });
  }

  async publishFlushAll(): Promise<void> {
    await this.publish({ type: "flush" });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (!this.subscriber) return;
    if (this.subscriber.status === "ready") await this.subscriber.quit();
    else this.subscriber.disconnect();
    this.subscriber = null;
  }

  private async publish(message: InvalidationMessage): Promise<void> {
    try {
      await this.publisher.publish(invalidationChannel(this.releaseId), JSON.stringify(message));
    } catch (error) {
      logger.warn("cache invalidation publish failed", {
        type: message.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function applyInvalidationToL1(l1: MemoryStore, message: InvalidationMessage): void {
  switch (message.type) {
    case "key":
      void l1.deleteKey(message.key);
      break;
    case "keys":
      void l1.deleteKeys(message.keys);
      break;
    case "prefix":
      void l1.deleteByPrefix(message.prefix);
      break;
    case "flush":
      l1.flushAllSync();
      break;
  }
}

export function createInvalidationHandler(
  store: TieredStore,
): (message: InvalidationMessage) => void {
  return (message) => {
    applyInvalidationToL1(store.l1, message);
  };
}
