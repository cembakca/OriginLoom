import { config } from "./config";
import { observeSsrCapacityRejection, observeSsrQueueWait, setSsrCapacityState } from "./metrics";

export type SsrCapacityRejectionReason = "queue_full" | "wait_timeout" | "request_aborted";

export class SsrCapacityError extends Error {
  constructor(readonly reason: SsrCapacityRejectionReason) {
    super(`SSR capacity rejected request: ${reason}`);
    this.name = "SsrCapacityError";
  }
}

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: SsrCapacityError) => void;
  started: number;
  signal: AbortSignal;
  timeout: ReturnType<typeof setTimeout>;
  onAbort: () => void;
};

export class SsrCapacity {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxQueue: number,
    private readonly waitTimeoutMs: number,
  ) {
    this.publishState();
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await work();
    } finally {
      release();
    }
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(this.reject("request_aborted"));

    if (this.active < this.maxConcurrency) {
      this.active++;
      this.publishState();
      observeSsrQueueWait("accepted", 0);
      return Promise.resolve(this.releaseOnce());
    }

    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(this.reject("queue_full"));
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter = {} as Waiter;
      waiter.resolve = resolve;
      waiter.reject = reject;
      waiter.started = performance.now();
      waiter.signal = signal;
      waiter.onAbort = () => this.removeAndReject(waiter, "request_aborted");
      waiter.timeout = setTimeout(
        () => this.removeAndReject(waiter, "wait_timeout"),
        this.waitTimeoutMs,
      );
      waiter.timeout.unref?.();
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.queue.push(waiter);
      this.publishState();
    });
  }

  private removeAndReject(waiter: Waiter, reason: SsrCapacityRejectionReason): void {
    const index = this.queue.indexOf(waiter);
    if (index === -1) return;
    this.queue.splice(index, 1);
    this.cleanupWaiter(waiter);
    observeSsrQueueWait("rejected", performance.now() - waiter.started);
    waiter.reject(this.reject(reason));
    this.publishState();
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    while (this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      this.cleanupWaiter(waiter);
      if (waiter.signal.aborted) {
        observeSsrQueueWait("rejected", performance.now() - waiter.started);
        waiter.reject(this.reject("request_aborted"));
        continue;
      }
      observeSsrQueueWait("accepted", performance.now() - waiter.started);
      waiter.resolve(this.releaseOnce());
      this.publishState();
      return;
    }

    this.active = Math.max(0, this.active - 1);
    this.publishState();
  }

  private cleanupWaiter(waiter: Waiter): void {
    clearTimeout(waiter.timeout);
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }

  private reject(reason: SsrCapacityRejectionReason): SsrCapacityError {
    observeSsrCapacityRejection(reason);
    return new SsrCapacityError(reason);
  }

  private publishState(): void {
    setSsrCapacityState(this.active, this.queue.length);
  }
}

export const ssrCapacity = new SsrCapacity(
  config.ssrMaxConcurrency,
  config.ssrMaxQueue,
  config.ssrQueueWaitMs,
);

export function ssrCapacityResponse(error: SsrCapacityError, requestId?: string): Response {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": "text/html; charset=utf-8",
    "retry-after": "1",
    "x-ssr-rejection": error.reason,
  });
  if (requestId) headers.set("x-request-id", requestId);

  return new Response(
    '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Sunucu yoğun</title></head><body><main><h1>Sunucu şu anda yoğun</h1><p>Lütfen kısa süre sonra yeniden deneyin.</p></main></body></html>',
    { status: 503, headers },
  );
}
