import { cacheRouteLabel } from "./metrics/cache-label.js";
import {
  counterLines,
  type CounterMap,
  escapeLabel,
  gauge,
  Histogram,
  increment,
} from "./metrics/primitives.js";
import { runtimeMetricLines } from "./metrics/runtime.js";
import { tryGetRuntime } from "./runtime.js";

type GatewayOutcome = "success" | "client_error" | "server_error" | "timeout" | "network_error";
type OperationOutcome = "success" | "error";

const DURATION_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 15_000];
const BODY_SIZE_BUCKETS_BYTES = [1_024, 10_240, 51_200, 102_400, 262_144, 524_288, 1_048_576];
const KEY_SIZE_BUCKETS_BYTES = [32, 64, 128, 256, 512, 1_024];
const MAX_DISTINCT_KEYS_PER_ROUTE = 2_000;
const MAX_DISTINCT_CLIENT_ISLANDS = 100;
const MAX_COMPILED_REQUEST_LABELS = 1_000;
const KNOWN_CACHE_STATES = new Set([
  "HIT",
  "MISS",
  "STALE",
  "BYPASS",
  "ERROR",
  "NONE",
  "REDIRECT",
  "PROXY",
]);
const compiledRequestLabels = new Map<string, { request: string; cache?: string }>();
const requests: CounterMap = new Map();
const gatewayRequests: CounterMap = new Map();
const cacheOperations: CounterMap = new Map();
const revalidations: CounterMap = new Map();
const cacheCardinalityOverflows: CounterMap = new Map();
const invalidGatewayPayloads: CounterMap = new Map();
const shellDegradations: CounterMap = new Map();
const cacheFills: CounterMap = new Map();
const coalescedWaits: CounterMap = new Map();
const coldMissLockTimeouts: CounterMap = new Map();
const cachePromotions: CounterMap = new Map();
const botAnalyticsEnqueues: CounterMap = new Map();
const botAnalyticsDrops: CounterMap = new Map();
const botAnalyticsBatches: CounterMap = new Map();
const botAnalyticsDrains: CounterMap = new Map();
const clientErrorTelemetry: CounterMap = new Map();
const clientRuntimeErrors: CounterMap = new Map();
const clientMetricIngestion: CounterMap = new Map();
const clientWebVitals: CounterMap = new Map();
const requestTimeouts: CounterMap = new Map();
const ssrCapacityRejections: CounterMap = new Map();
const distinctCacheKeys = new Map<string, Set<string>>();
const distinctClientIslands = new Set<string>();
const requestDurations = new Histogram(DURATION_BUCKETS_MS);
const cacheResponseDurations = new Histogram(DURATION_BUCKETS_MS);
const gatewayDurations = new Histogram(DURATION_BUCKETS_MS);
const cacheDurations = new Histogram(DURATION_BUCKETS_MS);
const revalidationDurations = new Histogram(DURATION_BUCKETS_MS);
const cacheBodySizes = new Histogram(BODY_SIZE_BUCKETS_BYTES);
const cacheKeySizes = new Histogram(KEY_SIZE_BUCKETS_BYTES);
const cacheFillDurations = new Histogram(DURATION_BUCKETS_MS);
const coalescedWaitDurations = new Histogram(DURATION_BUCKETS_MS);
const botAnalyticsBatchDurations = new Histogram(DURATION_BUCKETS_MS);
const botAnalyticsBatchSizes = new Histogram([1, 5, 10, 25, 50, 100]);
const ssrQueueWaitDurations = new Histogram(DURATION_BUCKETS_MS);
const clientIslandMountDurations = new Histogram(DURATION_BUCKETS_MS);
const serializationDurations = new Histogram(DURATION_BUCKETS_MS);
const payloadSizes = new Histogram(BODY_SIZE_BUCKETS_BYTES);
let botAnalyticsQueueDepth = 0;
let botAnalyticsInFlight = 0;
let ssrRenderInFlight = 0;
let ssrRenderQueueDepth = 0;
let cacheL2Healthy = true;

function statusClass(status: number): string {
  return status === 0 ? "error" : `${Math.floor(status / 100)}xx`;
}

export function observeRequest(
  status: number,
  cacheState: string,
  durationMs: number,
  route: string,
): void {
  const cache = KNOWN_CACHE_STATES.has(cacheState) ? cacheState : "NONE";
  const labels = requestMetricLabels(statusClass(status), cache, route);
  increment(requests, labels.request);
  requestDurations.observe(labels.request, durationMs);
  if (labels.cache) cacheResponseDurations.observe(labels.cache, durationMs);
}

export function observeGatewayRequest(
  status: number,
  durationMs: number,
  outcome: GatewayOutcome = gatewayOutcome(status),
): void {
  const labels = `status_class="${statusClass(status)}",outcome="${outcome}"`;
  increment(gatewayRequests, labels);
  gatewayDurations.observe(`outcome="${outcome}"`, durationMs);
}

export function observeInvalidGatewayPayload(
  contract: string,
  reason: "json" | "schema" | "size",
): void {
  increment(invalidGatewayPayloads, `contract="${escapeLabel(contract)}",reason="${reason}"`);
}

/** Bounded route/contract labels only; never pass a raw URL or user-controlled value. */
export function observeSerialization(
  kind: "document_render" | "gateway_json_parse",
  label: string,
  durationMs: number,
): void {
  serializationDurations.observe(
    `kind="${kind}",label="${escapeLabel(label)}"`,
    Math.max(0, durationMs),
  );
}

/** Payload size before HTTP compression, labelled by a declared route or gateway contract. */
export function observePayloadSize(
  kind: "html" | "gateway_json",
  label: string,
  bytes: number,
): void {
  payloadSizes.observe(`kind="${kind}",label="${escapeLabel(label)}"`, Math.max(0, bytes));
}

export function observeShellDegradation(
  component: "menu",
  reason: "gateway_error" | "invalid_payload",
): void {
  increment(shellDegradations, `component="${component}",reason="${reason}"`);
}

export function observeCacheFill(
  outcome: "success" | "race_hit" | "terminal" | "write_error" | "error" | "timeout",
  durationMs: number,
): void {
  const labels = `outcome="${outcome}"`;
  increment(cacheFills, labels);
  cacheFillDurations.observe(labels, durationMs);
}

export function observeCoalescedWait(
  scope: "process" | "redis",
  outcome: "filled" | "terminal" | "cache_hit" | "stale" | "lock_acquired" | "timeout" | "error",
  durationMs: number,
): void {
  const labels = `scope="${scope}",outcome="${outcome}"`;
  increment(coalescedWaits, labels);
  coalescedWaitDurations.observe(labels, durationMs);
}

export function observeColdMissLockTimeout(): void {
  increment(coldMissLockTimeouts, 'outcome="timeout"');
}

export function observeBotAnalyticsEnqueue(
  outcome: "queued" | "deduplicated" | "sampled" | "queue_full" | "closed",
): void {
  increment(botAnalyticsEnqueues, `outcome="${outcome}"`);
}

export function observeBotAnalyticsDrop(
  reason: "queue_full" | "closed" | "shutdown_timeout",
  count = 1,
): void {
  const labels = `reason="${reason}"`;
  botAnalyticsDrops.set(labels, (botAnalyticsDrops.get(labels) ?? 0) + count);
}

export function observeBotAnalyticsBatch(
  outcome: "success" | "rejected" | "error" | "aborted",
  eventCount: number,
  durationMs: number,
): void {
  const labels = `outcome="${outcome}"`;
  increment(botAnalyticsBatches, labels);
  botAnalyticsBatchDurations.observe(labels, durationMs);
  botAnalyticsBatchSizes.observe(labels, eventCount);
}

export function observeBotAnalyticsDrain(outcome: "success" | "timeout"): void {
  increment(botAnalyticsDrains, `outcome="${outcome}"`);
}

export function setBotAnalyticsQueueState(queueDepth: number, inFlight: number): void {
  botAnalyticsQueueDepth = Math.max(0, queueDepth);
  botAnalyticsInFlight = Math.max(0, inFlight);
}

export function observeClientErrorTelemetry(
  outcome:
    "accepted" | "invalid" | "sampled" | "rate_limited" | "ip_rate_limited" | "global_rate_limited",
): void {
  increment(clientErrorTelemetry, `outcome="${outcome}"`);
}

export function observeClientRuntimeError(source: string): void {
  increment(clientRuntimeErrors, `source="${escapeLabel(source)}"`);
}

export function observeClientMetricIngestion(
  outcome: "accepted" | "invalid" | "rate_limited",
): void {
  increment(clientMetricIngestion, `outcome="${outcome}"`);
}

export function observeClientPerformance(
  metric:
    | {
        kind: "web-vital";
        name: "CLS" | "INP" | "LCP";
        value: number;
        rating: "good" | "needs-improvement" | "poor";
      }
    | { kind: "island-mount"; name: string; value: number },
): void {
  if (metric.kind === "web-vital") {
    increment(clientWebVitals, `name="${metric.name}",rating="${metric.rating}"`);
  } else {
    const knownIsland = distinctClientIslands.has(metric.name);
    if (!knownIsland && distinctClientIslands.size < MAX_DISTINCT_CLIENT_ISLANDS) {
      distinctClientIslands.add(metric.name);
    }
    const island = knownIsland || distinctClientIslands.has(metric.name) ? metric.name : "other";
    clientIslandMountDurations.observe(`island="${escapeLabel(island)}"`, metric.value);
  }
}

export function observeRequestTimeout(requestClass: "api" | "proxy" | "ssr", route: string): void {
  increment(requestTimeouts, `class="${requestClass}",route="${escapeLabel(route)}"`);
}

export function observeSsrQueueWait(outcome: "accepted" | "rejected", durationMs: number): void {
  ssrQueueWaitDurations.observe(`outcome="${outcome}"`, durationMs);
}

export function observeSsrCapacityRejection(
  reason: "queue_full" | "wait_timeout" | "request_aborted",
): void {
  increment(ssrCapacityRejections, `reason="${reason}"`);
}

export function setSsrCapacityState(inFlight: number, queueDepth: number): void {
  ssrRenderInFlight = Math.max(0, inFlight);
  ssrRenderQueueDepth = Math.max(0, queueDepth);
}

export function observeCachePromotion(source: "l2"): void {
  increment(cachePromotions, `source="${source}"`);
}

/** Tracks L2 (Redis) reachability independently of readiness routing — a degraded L2
 * can be non-fatal to readiness (CACHE_REQUIRED=false) while still needing to be visible. */
export function setCacheL2Health(healthy: boolean): void {
  cacheL2Healthy = healthy;
}

export function observeCacheOperation(
  backend: "memory" | "redis" | "memory+redis",
  operation: string,
  outcome: OperationOutcome,
  durationMs: number,
): void {
  const labels = `backend="${backend}",operation="${operation}",outcome="${outcome}"`;
  increment(cacheOperations, labels);
  cacheDurations.observe(labels, durationMs);
}

export function observeRevalidation(
  outcome: "success" | "error" | "lock_miss",
  durationMs: number,
) {
  const labels = `outcome="${outcome}"`;
  increment(revalidations, labels);
  revalidationDurations.observe(labels, durationMs);
}

/** Bounded, per-process early-warning metrics for cache cardinality and entry size. */
export function observeCacheEntryWrite(key: string, body: string): void {
  const route = cacheRouteLabel(key);
  const labels = `route="${route}"`;
  cacheBodySizes.observe(labels, Buffer.byteLength(body));
  cacheKeySizes.observe(labels, Buffer.byteLength(key));

  const keys = distinctCacheKeys.get(route) ?? new Set<string>();
  if (!distinctCacheKeys.has(route)) distinctCacheKeys.set(route, keys);
  if (keys.has(key)) return;
  if (keys.size < MAX_DISTINCT_KEYS_PER_ROUTE) keys.add(key);
  else increment(cacheCardinalityOverflows, labels);
}

function gatewayOutcome(status: number): GatewayOutcome {
  if (status >= 500 || status === 0) return status === 0 ? "network_error" : "server_error";
  if (status >= 400) return "client_error";
  return "success";
}

function requestMetricLabels(
  status: string,
  cache: string,
  route: string,
): { request: string; cache?: string } {
  const key = `${status}\0${cache}\0${route}`;
  const existing = compiledRequestLabels.get(key);
  if (existing) return existing;
  const escapedRoute = escapeLabel(route);
  const compiled = {
    request: `status_class="${status}",cache="${cache}",route="${escapedRoute}"`,
    ...((cache === "HIT" || cache === "MISS" || cache === "STALE") && {
      cache: `state="${cache}",route="${escapedRoute}"`,
    }),
  };
  // Route labels come from the declared route table. The cap is defense in
  // depth if an app violates that contract; the hot set remains precompiled.
  if (compiledRequestLabels.size < MAX_COMPILED_REQUEST_LABELS) {
    compiledRequestLabels.set(key, compiled);
  }
  return compiled;
}

function cacheCardinalityLines(): string[] {
  const lines = [
    "# HELP ssr_cache_distinct_keys_observed Distinct cache keys observed by this process since startup",
    "# TYPE ssr_cache_distinct_keys_observed gauge",
  ];
  for (const [route, keys] of [...distinctCacheKeys.entries()].sort()) {
    lines.push(`ssr_cache_distinct_keys_observed{route="${route}"} ${keys.size}`);
  }
  return lines;
}

export function renderMetrics(): string {
  const lines = [
    ...counterLines("ssr_http_requests_total", "HTTP requests", requests),
    ...requestDurations.lines("ssr_http_request_duration_milliseconds", "HTTP request duration"),
    ...cacheResponseDurations.lines(
      "ssr_cache_response_duration_milliseconds",
      "End-to-end response duration by cache state",
    ),
    ...counterLines("ssr_gateway_requests_total", "Gateway requests by outcome", gatewayRequests),
    ...counterLines(
      "ssr_gateway_invalid_payload_total",
      "Gateway payloads rejected by the runtime contract",
      invalidGatewayPayloads,
    ),
    ...serializationDurations.lines(
      "ssr_serialization_duration_milliseconds",
      "Document render and gateway JSON parse duration",
    ),
    ...payloadSizes.lines(
      "ssr_payload_size_bytes",
      "Uncompressed SSR HTML and gateway JSON payload size",
    ),
    ...counterLines(
      "ssr_shell_degraded_total",
      "Non-critical shell components rendered with controlled fallback data",
      shellDegradations,
    ),
    ...counterLines("ssr_cache_fill_total", "Cold cache fill attempts", cacheFills),
    ...cacheFillDurations.lines(
      "ssr_cache_fill_duration_milliseconds",
      "Cold cache loader, render and write duration",
    ),
    ...counterLines(
      "ssr_cache_coalesced_wait_total",
      "Requests coalesced behind an in-process or Redis cold fill",
      coalescedWaits,
    ),
    ...coalescedWaitDurations.lines(
      "ssr_cache_coalesced_wait_duration_milliseconds",
      "Time spent waiting for a coalesced cold fill",
    ),
    ...counterLines(
      "ssr_cache_lock_timeout_total",
      "Cold miss waits that exhausted the Redis lock wait budget",
      coldMissLockTimeouts,
    ),
    ...counterLines(
      "ssr_bot_analytics_enqueue_total",
      "Bot analytics enqueue decisions",
      botAnalyticsEnqueues,
    ),
    ...counterLines(
      "ssr_bot_analytics_dropped_total",
      "Bot analytics events dropped before delivery",
      botAnalyticsDrops,
    ),
    ...counterLines(
      "ssr_bot_analytics_batches_total",
      "Bot analytics batch delivery outcomes",
      botAnalyticsBatches,
    ),
    ...botAnalyticsBatchDurations.lines(
      "ssr_bot_analytics_batch_duration_milliseconds",
      "Bot analytics batch gateway duration",
    ),
    ...botAnalyticsBatchSizes.lines(
      "ssr_bot_analytics_batch_size",
      "Bot analytics events per delivered batch",
    ),
    ...counterLines(
      "ssr_bot_analytics_drains_total",
      "Bot analytics shutdown drain outcomes",
      botAnalyticsDrains,
    ),
    ...gauge(
      "ssr_bot_analytics_queue_depth",
      "Bot analytics events currently waiting in memory",
      botAnalyticsQueueDepth,
    ),
    ...gauge(
      "ssr_bot_analytics_in_flight",
      "Bot analytics batches currently in flight",
      botAnalyticsInFlight,
    ),
    ...counterLines(
      "ssr_client_error_telemetry_total",
      "Client runtime error ingestion outcomes",
      clientErrorTelemetry,
    ),
    ...counterLines(
      "ssr_client_runtime_errors_total",
      "Accepted client runtime errors by source",
      clientRuntimeErrors,
    ),
    ...counterLines(
      "ssr_client_metric_ingestion_total",
      "Client performance metric ingestion outcomes",
      clientMetricIngestion,
    ),
    ...counterLines(
      "ssr_client_web_vitals_total",
      "Core Web Vitals observations by rating",
      clientWebVitals,
    ),
    ...clientIslandMountDurations.lines(
      "ssr_client_island_mount_duration_milliseconds",
      "Successful island mount duration",
    ),
    ...counterLines(
      "request_timeout_total",
      "Requests terminated after exceeding their class deadline",
      requestTimeouts,
    ),
    ...counterLines(
      "ssr_render_rejections_total",
      "SSR requests rejected by bounded render capacity",
      ssrCapacityRejections,
    ),
    ...ssrQueueWaitDurations.lines(
      "ssr_render_queue_wait_milliseconds",
      "Time SSR requests spent waiting for render capacity",
    ),
    ...gauge(
      "ssr_render_in_flight",
      "SSR requests currently holding render capacity",
      ssrRenderInFlight,
    ),
    ...gauge(
      "ssr_render_queue_depth",
      "SSR requests currently waiting for render capacity",
      ssrRenderQueueDepth,
    ),
    ...gatewayDurations.lines(
      "ssr_gateway_request_duration_milliseconds",
      "Gateway request duration",
    ),
    ...counterLines("ssr_cache_operations_total", "Cache operations by backend", cacheOperations),
    ...counterLines(
      "ssr_cache_promotion_total",
      "L2 cache hits promoted into local L1",
      cachePromotions,
    ),
    ...gauge(
      "ssr_cache_l2_healthy",
      "Whether the L2 (Redis) cache last responded to a ping (1) or not (0)",
      cacheL2Healthy ? 1 : 0,
    ),
    ...cacheDurations.lines(
      "ssr_cache_operation_duration_milliseconds",
      "Cache operation duration",
    ),
    ...counterLines("ssr_cache_revalidations_total", "SWR revalidations", revalidations),
    ...revalidationDurations.lines(
      "ssr_cache_revalidation_duration_milliseconds",
      "SWR revalidation duration",
    ),
    ...cacheBodySizes.lines("ssr_cache_entry_body_bytes", "Cache entry body size in bytes"),
    ...cacheKeySizes.lines("ssr_cache_key_bytes", "Logical cache key size in bytes"),
    ...cacheCardinalityLines(),
    ...counterLines(
      "ssr_cache_cardinality_overflow_total",
      `Distinct cache keys exceeding the bounded ${MAX_DISTINCT_KEYS_PER_ROUTE}-key observation window`,
      cacheCardinalityOverflows,
    ),
    ...(tryGetRuntime()?.metricSources ?? []).flatMap((source) => source()),
    ...runtimeMetricLines(),
  ];
  return `${lines.join("\n")}\n`;
}
