import type { SsrFragmentMarker } from "@originloom/shared/fragment-markup";
import type { CachePolicy } from "@originloom/shared/lib/types";

import { config } from "../config.js";
import { observeCacheFill, observeCoalescedWait, observeColdMissLockTimeout } from "../metrics.js";
import * as cache from "./index.js";

export type ColdFillWork<T> = {
  value: T;
  body?: string;
  cacheable: boolean;
  terminal: boolean;
};

export type ColdFillResult<T> =
  | {
      kind: "cache";
      body: string;
      state: "HIT" | "STALE";
      hasFragments: boolean;
      fragmentMarkers: readonly SsrFragmentMarker[];
    }
  | { kind: "work"; work: ColdFillWork<T> };

const fillsInFlight = new Map<string, Promise<ColdFillResult<unknown>>>();

export async function coalesceColdMiss<T>(options: {
  key: string;
  policy: CachePolicy;
  work: () => Promise<ColdFillWork<T>>;
  isTimeout: (error: unknown) => boolean;
}): Promise<ColdFillResult<T>> {
  const existing = fillsInFlight.get(options.key) as Promise<ColdFillResult<T>> | undefined;
  if (existing) return observeProcessWait(existing);

  const pending = runDistributedColdFill(options).finally(() => {
    if (fillsInFlight.get(options.key) === pending) fillsInFlight.delete(options.key);
  });
  fillsInFlight.set(options.key, pending);
  return pending;
}

async function observeProcessWait<T>(
  pending: Promise<ColdFillResult<T>>,
): Promise<ColdFillResult<T>> {
  const started = performance.now();
  try {
    const result = await pending;
    const outcome =
      result.kind === "cache"
        ? result.state === "STALE"
          ? "stale"
          : "cache_hit"
        : result.work.terminal
          ? "terminal"
          : "filled";
    observeCoalescedWait("process", outcome, performance.now() - started);
    return result;
  } catch (error) {
    observeCoalescedWait("process", "error", performance.now() - started);
    throw error;
  }
}

async function runDistributedColdFill<T>(
  options: Parameters<typeof coalesceColdMiss<T>>[0],
): Promise<ColdFillResult<T>> {
  if (!cache.isL2Configured()) {
    return fillUnderLock(options, crypto.randomUUID());
  }

  const firstLock = await cache.acquireColdMissLock(options.key);
  if (firstLock.kind === "acquired") return fillUnderLock(options, firstLock.token);
  if (firstLock.kind === "unavailable") return { kind: "work", work: await options.work() };

  const started = performance.now();
  const deadline = Date.now() + config.cacheFillWaitMs;
  while (Date.now() < deadline) {
    await delay(Math.min(config.cacheFillPollMs, Math.max(1, deadline - Date.now())));
    const hit = await cache.read(options.key);
    if (hit) {
      const state = hit.state === "fresh" ? "HIT" : "STALE";
      observeCoalescedWait(
        "redis",
        state === "HIT" ? "cache_hit" : "stale",
        performance.now() - started,
      );
      return {
        kind: "cache",
        body: hit.body,
        state,
        hasFragments: hit.hasFragments,
        fragmentMarkers: hit.fragmentMarkers,
      };
    }

    const retryLock = await cache.acquireColdMissLock(options.key);
    if (retryLock.kind === "acquired") {
      observeCoalescedWait("redis", "lock_acquired", performance.now() - started);
      return fillUnderLock(options, retryLock.token);
    }
    if (retryLock.kind === "unavailable") {
      observeCoalescedWait("redis", "error", performance.now() - started);
      return { kind: "work", work: await options.work() };
    }
  }

  observeCoalescedWait("redis", "timeout", performance.now() - started);
  observeColdMissLockTimeout();
  return { kind: "work", work: await options.work() };
}

async function fillUnderLock<T>(
  options: Parameters<typeof coalesceColdMiss<T>>[0],
  token: string,
): Promise<ColdFillResult<T>> {
  const started = performance.now();
  let outcome: "success" | "race_hit" | "terminal" | "write_error" | "error" | "timeout" = "error";
  try {
    const existing = await cache.read(options.key);
    if (existing) {
      outcome = "race_hit";
      return {
        kind: "cache",
        body: existing.body,
        state: existing.state === "fresh" ? "HIT" : "STALE",
        hasFragments: existing.hasFragments,
        fragmentMarkers: existing.fragmentMarkers,
      };
    }

    const work = await options.work();
    if (work.terminal || !work.cacheable) {
      outcome = "terminal";
    } else if (work.body === undefined) {
      throw new Error("Cacheable cold fill did not produce a body");
    } else {
      outcome = (await cache.write(options.key, work.body, options.policy))
        ? "success"
        : "write_error";
    }
    return { kind: "work", work };
  } catch (error) {
    outcome = options.isTimeout(error) ? "timeout" : "error";
    throw error;
  } finally {
    observeCacheFill(outcome, performance.now() - started);
    await cache.releaseColdMissLock(options.key, token);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
