import { renderMetrics } from "@originloom/core/metrics";
import { BotAnalyticsDispatcher, type BotVisit } from "@server/services/bot-analytics";
import { afterEach, describe, expect, it, vi } from "vitest";

const event = (pathname: string, userAgent = "ExampleBot/1.0"): BotVisit => ({
  pathname,
  userAgent,
  trackingId: "11111111-1111-4111-8111-111111111111",
});

describe("bot analytics dispatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("returns immediately while a bounded worker owns the gateway promise", async () => {
    let release: (() => void) | undefined;
    const sender = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const dispatcher = createDispatcher(sender, { batchSize: 1 });

    expect(dispatcher.enqueue(event("/robots"))).toBe("queued");
    expect(sender).toHaveBeenCalledTimes(1);
    expect(dispatcher.snapshot()).toEqual({ queued: 0, inFlight: 1, accepting: true });

    release?.();
    await vi.waitFor(() => expect(dispatcher.snapshot().inFlight).toBe(0));
    await expect(dispatcher.drain(100)).resolves.toBe(true);
  });

  it("bounds queue depth and sender concurrency, dropping overflow", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    const sender = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    });
    const dispatcher = createDispatcher(sender, {
      capacity: 2,
      concurrency: 1,
      batchSize: 1,
    });

    expect(dispatcher.enqueue(event("/one"))).toBe("queued");
    expect(dispatcher.enqueue(event("/two"))).toBe("queued");
    expect(dispatcher.enqueue(event("/three"))).toBe("queued");
    expect(dispatcher.enqueue(event("/four"))).toBe("queue_full");
    expect(dispatcher.snapshot()).toEqual({ queued: 2, inFlight: 1, accepting: true });

    await vi.runAllTimersAsync();
    await expect(dispatcher.drain(100)).resolves.toBe(true);
    expect(maxActive).toBe(1);
    expect(sender).toHaveBeenCalledTimes(3);
    expect(renderMetrics()).toContain('ssr_bot_analytics_dropped_total{reason="queue_full"} 1');
  });

  it("deduplicates bot and path, samples before enqueue and sends batches", async () => {
    const batches: BotVisit[][] = [];
    const sender = vi.fn(async (events: BotVisit[]) => {
      batches.push(events);
    });
    const dispatcher = createDispatcher(sender, { batchSize: 3 });

    expect(dispatcher.enqueue(event("/same"))).toBe("queued");
    expect(
      dispatcher.enqueue({ ...event("/same"), trackingId: "22222222-2222-4222-8222-222222222222" }),
    ).toBe("deduplicated");
    expect(dispatcher.enqueue(event("/two"))).toBe("queued");
    expect(dispatcher.enqueue(event("/three"))).toBe("queued");

    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    expect(batches[0]).toHaveLength(3);
    await expect(dispatcher.drain(100)).resolves.toBe(true);

    const sampled = createDispatcher(
      vi.fn(async () => undefined),
      {
        sampleRate: 0,
        random: () => 0.5,
      },
    );
    expect(sampled.enqueue(event("/sampled"))).toBe("sampled");
    expect(sampled.snapshot().queued).toBe(0);
    await expect(sampled.drain(100)).resolves.toBe(true);
  });

  it("drains partial batches during shutdown and stops accepting events", async () => {
    let release: (() => void) | undefined;
    const sender = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const dispatcher = createDispatcher(sender, { batchSize: 10 });
    dispatcher.enqueue(event("/queued"));

    const draining = dispatcher.drain(100);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueue(event("/too-late"))).toBe("closed");
    release?.();

    await expect(draining).resolves.toBe(true);
    expect(dispatcher.snapshot()).toEqual({ queued: 0, inFlight: 0, accepting: false });
  });

  it("drops queued work and aborts in-flight delivery when drain times out", async () => {
    vi.useFakeTimers();
    let deliverySignal: AbortSignal | undefined;
    const sender = vi.fn(
      (_events: BotVisit[], signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          deliverySignal = signal;
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const dispatcher = createDispatcher(sender, {
      capacity: 2,
      concurrency: 1,
      batchSize: 1,
    });
    dispatcher.enqueue(event("/active"));
    dispatcher.enqueue(event("/queued-one"));
    dispatcher.enqueue(event("/queued-two"));

    const draining = dispatcher.drain(50);
    await vi.advanceTimersByTimeAsync(50);

    await expect(draining).resolves.toBe(false);
    expect(deliverySignal?.aborted).toBe(true);
    expect(dispatcher.snapshot().queued).toBe(0);
    expect(renderMetrics()).toContain(
      'ssr_bot_analytics_dropped_total{reason="shutdown_timeout"} 2',
    );
  });
});

function createDispatcher(
  sender: (events: BotVisit[], signal: AbortSignal) => Promise<void>,
  overrides: Partial<{
    capacity: number;
    concurrency: number;
    batchSize: number;
    flushMs: number;
    dedupTtlMs: number;
    sampleRate: number;
    random: () => number;
  }> = {},
): BotAnalyticsDispatcher {
  return new BotAnalyticsDispatcher(
    {
      capacity: 10,
      concurrency: 2,
      batchSize: 5,
      flushMs: 1_000,
      dedupTtlMs: 60_000,
      sampleRate: 1,
      ...overrides,
    },
    sender,
  );
}
