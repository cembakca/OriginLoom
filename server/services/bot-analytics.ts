import { gatewayFetch } from "@server/adapters/gateway";
import { config } from "@server/config";

import {
  BotAnalyticsDispatcher,
  BotAnalyticsRejectedError,
  type BotVisit,
} from "./bot-analytics/dispatcher";

export type { BotVisit } from "./bot-analytics/dispatcher";
export { BotAnalyticsDispatcher } from "./bot-analytics/dispatcher";

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
