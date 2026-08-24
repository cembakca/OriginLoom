import { gatewayFetch } from "@originloom/core/adapters/gateway";
import { productConfig } from "@server/product/config";

import {
  BotAnalyticsDispatcher,
  BotAnalyticsRejectedError,
  type BotVisit,
} from "./bot-analytics/dispatcher";

export type { BotVisit } from "./bot-analytics/dispatcher";
export { BotAnalyticsDispatcher } from "./bot-analytics/dispatcher";

const dispatcher = new BotAnalyticsDispatcher(
  {
    capacity: productConfig.botAnalyticsQueueCapacity,
    concurrency: productConfig.botAnalyticsConcurrency,
    batchSize: productConfig.botAnalyticsBatchSize,
    flushMs: productConfig.botAnalyticsFlushMs,
    dedupTtlMs: productConfig.botAnalyticsDedupTtlMs,
    sampleRate: productConfig.botAnalyticsSampleRate,
  },
  sendBatch,
);

export function storeBotVisit(payload: BotVisit): void {
  dispatcher.enqueue(payload);
}

export function drainBotAnalytics(
  timeoutMs = productConfig.botAnalyticsDrainTimeoutMs,
): Promise<boolean> {
  return dispatcher.drain(timeoutMs);
}

async function sendBatch(events: BotVisit[], signal: AbortSignal): Promise<void> {
  // Fire-and-forget analytics: nothing ever reads this body, so the whole job
  // of the call site is to give the socket back. `await using` is that job.
  await using response = await gatewayFetch("/analytics/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
    signal,
  });
  if (!response.ok) throw new BotAnalyticsRejectedError(response.status);
}
