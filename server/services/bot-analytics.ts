import { createHash } from "node:crypto";

import { gatewayFetch } from "@server/adapters/gateway";
import { config } from "@server/config";
import { logger } from "@server/logger";
import {
  observeBotAnalyticsBatch,
  observeBotAnalyticsDrain,
  observeBotAnalyticsDrop,
  observeBotAnalyticsEnqueue,
  setBotAnalyticsQueueState,
} from "@server/metrics";

export type BotVisit = {
  pathname: string;
  userAgent: string;
  trackingId?: string;
};

type EnqueueOutcome = "queued" | "deduplicated" | "sampled" | "queue_full" | "closed";
type BatchSender = (events: BotVisit[], signal: AbortSignal) => Promise<void>;

type DispatcherOptions = {
  capacity: number;
  concurrency: number;
  batchSize: number;
  flushMs: number;
  dedupTtlMs: number;
  sampleRate: number;
  random?: () => number;
};

class BotAnalyticsRejectedError extends Error {
  constructor(readonly status: number) {
    super(`Bot analytics gateway returned ${status}`);
    this.name = "BotAnalyticsRejectedError";
  }
}

export class BotAnalyticsDispatcher {
  private readonly queue: BotVisit[] = [];
  private readonly dedup = new Map<string, number>();
  private readonly controllers = new Set<AbortController>();
  private readonly idleResolvers = new Set<() => void>();
  private readonly maxDedupEntries: number;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private activeBatches = 0;
  private accepting = true;

  constructor(
    private readonly options: DispatcherOptions,
    private readonly sender: BatchSender,
  ) {
    this.maxDedupEntries = options.capacity * 2;
    this.updateState();
  }

  enqueue(raw: BotVisit): EnqueueOutcome {
    if (!this.accepting) return this.rejectEnqueue("closed");

    const event = normalizeVisit(raw);
    const dedupKey = visitKey(event);
    const now = Date.now();
    this.pruneDedup(now);
    if ((this.dedup.get(dedupKey) ?? 0) > now) {
      observeBotAnalyticsEnqueue("deduplicated");
      return "deduplicated";
    }
    this.dedup.set(dedupKey, now + this.options.dedupTtlMs);

    if (
      this.options.sampleRate < 1 &&
      (this.options.random ?? Math.random)() >= this.options.sampleRate
    ) {
      observeBotAnalyticsEnqueue("sampled");
      return "sampled";
    }
    if (this.queue.length >= this.options.capacity) return this.rejectEnqueue("queue_full");

    this.queue.push(event);
    observeBotAnalyticsEnqueue("queued");
    this.updateState();
    if (this.queue.length >= this.options.batchSize) this.pump(false);
    else this.scheduleFlush();
    return "queued";
  }

  async drain(timeoutMs: number): Promise<boolean> {
    this.accepting = false;
    this.clearFlushTimer();
    this.pump(true);
    if (this.isIdle()) {
      observeBotAnalyticsDrain("success");
      return true;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const completed = new Promise<boolean>((resolve) => {
      this.idleResolvers.add(() => resolve(true));
    });
    const deadline = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
      timeout.unref?.();
    });
    const drained = await Promise.race([completed, deadline]);
    if (timeout) clearTimeout(timeout);

    if (!drained) {
      const dropped = this.queue.splice(0).length;
      if (dropped > 0) observeBotAnalyticsDrop("shutdown_timeout", dropped);
      for (const controller of this.controllers) controller.abort();
      this.updateState();
    }
    observeBotAnalyticsDrain(drained ? "success" : "timeout");
    return drained;
  }

  snapshot(): { queued: number; inFlight: number; accepting: boolean } {
    return { queued: this.queue.length, inFlight: this.activeBatches, accepting: this.accepting };
  }

  private rejectEnqueue(outcome: "queue_full" | "closed"): EnqueueOutcome {
    observeBotAnalyticsEnqueue(outcome);
    observeBotAnalyticsDrop(outcome);
    return outcome;
  }

  private pump(forcePartial: boolean): void {
    this.clearFlushTimer();
    while (
      this.activeBatches < this.options.concurrency &&
      this.queue.length > 0 &&
      (forcePartial || this.queue.length >= this.options.batchSize)
    ) {
      const events = this.queue.splice(0, this.options.batchSize);
      const controller = new AbortController();
      this.controllers.add(controller);
      this.activeBatches++;
      this.updateState();
      const started = performance.now();

      void this.sender(events, controller.signal)
        .then(() => observeBotAnalyticsBatch("success", events.length, performance.now() - started))
        .catch((error: unknown) => {
          const outcome = controller.signal.aborted
            ? "aborted"
            : error instanceof BotAnalyticsRejectedError
              ? "rejected"
              : "error";
          observeBotAnalyticsBatch(outcome, events.length, performance.now() - started);
          if (outcome !== "aborted") {
            logger.warn("bot analytics batch failed", {
              eventCount: events.length,
              ...(error instanceof BotAnalyticsRejectedError
                ? { status: error.status }
                : { error: error instanceof Error ? error.message : String(error) }),
            });
          }
        })
        .finally(() => {
          this.controllers.delete(controller);
          this.activeBatches--;
          this.updateState();
          if (this.accepting) {
            this.pump(false);
            this.scheduleFlush();
          } else {
            this.pump(true);
          }
          this.resolveIdle();
        });
    }
    if (this.accepting && this.queue.length > 0) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.queue.length === 0 || !this.accepting) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.pump(true);
    }, this.options.flushMs);
    this.flushTimer.unref?.();
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private pruneDedup(now: number): void {
    for (const [key, expiresAt] of this.dedup) {
      if (expiresAt > now) break;
      this.dedup.delete(key);
    }
    while (this.dedup.size >= this.maxDedupEntries) {
      const oldest = this.dedup.keys().next().value;
      if (oldest === undefined) break;
      this.dedup.delete(oldest);
    }
  }

  private isIdle(): boolean {
    return this.queue.length === 0 && this.activeBatches === 0;
  }

  private resolveIdle(): void {
    if (!this.isIdle()) return;
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }

  private updateState(): void {
    setBotAnalyticsQueueState(this.queue.length, this.activeBatches);
  }
}

const dispatcher = new BotAnalyticsDispatcher(
  {
    capacity: config.botAnalyticsQueueCapacity,
    concurrency: config.botAnalyticsConcurrency,
    batchSize: config.botAnalyticsBatchSize,
    flushMs: config.botAnalyticsFlushMs,
    dedupTtlMs: config.botAnalyticsDedupTtlMs,
    sampleRate: config.botAnalyticsSampleRate,
  },
  sendBatch,
);

export function storeBotVisit(payload: BotVisit): void {
  dispatcher.enqueue(payload);
}

export function drainBotAnalytics(timeoutMs = config.botAnalyticsDrainTimeoutMs): Promise<boolean> {
  return dispatcher.drain(timeoutMs);
}

async function sendBatch(events: BotVisit[], signal: AbortSignal): Promise<void> {
  const response = await gatewayFetch("/analytics/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
    signal,
  });
  if (!response.ok) throw new BotAnalyticsRejectedError(response.status);
}

function normalizeVisit(value: BotVisit): BotVisit {
  return {
    pathname: value.pathname.slice(0, 2_048),
    userAgent: value.userAgent.slice(0, 512),
    ...(value.trackingId ? { trackingId: value.trackingId.slice(0, 128) } : {}),
  };
}

function visitKey(value: BotVisit): string {
  return createHash("sha256")
    .update(value.pathname)
    .update("\0")
    .update(value.userAgent)
    .digest("hex");
}
