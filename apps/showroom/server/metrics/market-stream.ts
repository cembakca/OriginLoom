import {
  counterLines,
  type CounterMap,
  gauge,
  increment,
} from "@originloom/core/metrics/primitives";

const connections: CounterMap = new Map();
const events: CounterMap = new Map();
let activeConnections = 0;

export function observeMarketStreamConnection(
  outcome: "accepted" | "closed" | "invalid_request" | "ip_limited" | "global_limited",
): void {
  increment(connections, `outcome="${outcome}"`);
}

export function observeMarketStreamEvent(outcome: "received" | "invalid" | "coalesced"): void {
  increment(events, `outcome="${outcome}"`);
}

export function setMarketStreamActiveConnections(count: number): void {
  activeConnections = Math.max(0, count);
}

export function marketStreamMetricLines(): string[] {
  return [
    ...counterLines(
      "ssr_market_stream_connections_total",
      "Market stream browser connection outcomes",
      connections,
    ),
    ...counterLines(
      "ssr_market_stream_events_total",
      "Market stream upstream event outcomes",
      events,
    ),
    ...gauge(
      "ssr_market_stream_active_connections",
      "Active browser market stream connections",
      activeConnections,
    ),
  ];
}
