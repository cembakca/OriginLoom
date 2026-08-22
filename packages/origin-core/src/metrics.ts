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
const shellDependencies: CounterMap = new Map();
const cacheFills: CounterMap = new Map();
const coalescedWaits: CounterMap = new Map();
const coldMissLockTimeouts: CounterMap = new Map();
const cachePromotions: CounterMap = new Map();
const l1CacheEvictions: CounterMap = new Map();
const l1CacheRejections: CounterMap = new Map();
const l1CacheBytes = new Map<string, number>();
const l1CacheEntries = new Map<string, number>();
const cacheFastPathReads: CounterMap = new Map();
const cachedResourceAccesses: CounterMap = new Map();
const cachedResourceCoalescing: CounterMap = new Map();
const cachedResourceDegradations: CounterMap = new Map();
const cachedResourceRefreshes: CounterMap = new Map();
const fragmentAccesses: CounterMap = new Map();
const fragmentRefreshes: CounterMap = new Map();
const fragmentFallbacks: CounterMap = new Map();
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
const cachedResourceRefreshDurations = new Histogram(DURATION_BUCKETS_MS);
const fragmentRefreshDurations = new Histogram(DURATION_BUCKETS_MS);
const shellDependencyDurations = new Histogram(DURATION_BUCKETS_MS);
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

function labeledGaugeLines(name: string, help: string, values: Map<string, number>): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    ...[...values.entries()].sort().map(([labels, value]) => `${name}{${labels}} ${value}`),
  ];
}

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

export function observeShellDependency(
  dependency:
    | "request_facts"
    | "public_snapshot"
    | "targeting"
    | "request_overlay"
    | "compose"
    | "terminal"
    | "legacy",
  outcome: "success" | "error" | "aborted",
  durationMs: number,
): void {
  const labels = `dependency="${dependency}",outcome="${outcome}"`;
  increment(shellDependencies, labels);
  shellDependencyDurations.observe(labels, durationMs);
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

export function setL1CacheState(namespace: string, bytes: number, entries: number): void {
  const label = `namespace="${escapeLabel(namespace)}"`;
  l1CacheBytes.set(label, Math.max(0, bytes));
  l1CacheEntries.set(label, Math.max(0, entries));
}

export function observeL1CacheEviction(namespace: string, reason: string): void {
  increment(
    l1CacheEvictions,
    `namespace="${escapeLabel(namespace)}",reason="${escapeLabel(reason)}"`,
  );
}

export function observeL1CacheRejection(namespace: string, reason: string): void {
  increment(
    l1CacheRejections,
    `namespace="${escapeLabel(namespace)}",reason="${escapeLabel(reason)}"`,
  );
}

export type CachedResourceAccessState = "fresh" | "stale" | "miss";
export type CachedResourceAccessResult = "value" | "not-found" | "no-content" | "error";

/** Single source of truth for the label shape, shared by the per-call and precomputed paths. */
export function buildCachedResourceAccessLabel(
  resource: string,
  state: CachedResourceAccessState,
  result: CachedResourceAccessResult,
): string {
  return `resource="${escapeLabel(resource)}",state="${state}",result="${result}"`;
}

export function observeCachedResourceAccess(
  resource: string,
  state: CachedResourceAccessState,
  result: CachedResourceAccessResult,
): void {
  increment(cachedResourceAccesses, buildCachedResourceAccessLabel(resource, state, result));
}

/**
 * Same counter and label shape as `observeCachedResourceAccess`, but takes an
 * already-built label string. `defineCachedResource()` precomputes the label
 * for every (state, result) combination once per resource — via
 * `buildCachedResourceAccessLabel` — instead of template-building and
 * escaping a string on every single access. See `cache/resource.ts`.
 */
export function observeCachedResourceAccessPrecomputed(label: string): void {
  increment(cachedResourceAccesses, label);
}

export function observeCachedResourceCoalescing(
  resource: string,
  operation: "fill" | "refresh",
): void {
  increment(
    cachedResourceCoalescing,
    `resource="${escapeLabel(resource)}",operation="${operation}"`,
  );
}

export function observeCachedResourceDegradation(
  resource: string,
  reason:
    | "codec_version"
    | "coordination_timeout"
    | "coordination_unavailable"
    | "corrupt"
    | "invalid_value"
    | "resource_version"
    | "serialization_error"
    | "stale_if_error"
    | "write_error",
): void {
  increment(cachedResourceDegradations, `resource="${escapeLabel(resource)}",reason="${reason}"`);
}

export function observeCachedResourceRefresh(
  resource: string,
  outcome: "success" | "error" | "timeout" | "lock_miss",
  durationMs: number,
): void {
  const labels = `resource="${escapeLabel(resource)}",outcome="${outcome}"`;
  increment(cachedResourceRefreshes, labels);
  cachedResourceRefreshDurations.observe(labels, durationMs);
}

/** Fragment names come from the installed runtime declaration, never from the request URL. */
export function observeFragmentAccess(fragment: string, state: "fresh" | "stale" | "miss"): void {
  increment(fragmentAccesses, `fragment="${escapeLabel(fragment)}",state="${state}"`);
}

export function observeFragmentRefresh(
  fragment: string,
  outcome: "success" | "error" | "timeout" | "lock_miss" | "race_hit",
  durationMs: number,
): void {
  const labels = `fragment="${escapeLabel(fragment)}",outcome="${outcome}"`;
  increment(fragmentRefreshes, labels);
  fragmentRefreshDurations.observe(labels, durationMs);
}

export function observeFragmentFallback(fragment: string, reason: "timeout" | "error"): void {
  increment(fragmentFallbacks, `fragment="${escapeLabel(fragment)}",reason="${reason}"`);
}

/** Tracks L2 (Redis) reachability independently of readiness routing — a degraded L2
 * can be non-fatal to readiness (CACHE_REQUIRED=false) while still needing to be visible. */
export function setCacheL2Health(healthy: boolean): void {
  cacheL2Healthy = healthy;
}

/**
 * The untraced L1-fresh-hit fast path (see `cache/index.ts` `read()`) skips
 * `observeCacheOperation`'s span + duration histogram entirely — that's most
 * of what makes it fast. Both labels below are precomputed: the backend is
 * already one of three fixed literals, so neither escaping nor templating is
 * needed on the request path.
 *
 * Two counters are incremented, not one:
 *   - `ssr_cache_operations_total{...,operation="read",outcome="success"}` —
 *     the *same* series a traced read produces, so that counter does not
 *     silently collapse to near-zero once the cache is warm and every existing
 *     dashboard/alert built on cache read volume keeps working.
 *   - `ssr_cache_fast_path_reads_total` — the numerator for "what fraction of
 *     reads skipped tracing", which is the only thing that is genuinely new.
 *
 * The duration histogram is intentionally not fed here; see `tryFastRead`.
 */
const CACHE_FAST_PATH_LABELS = {
  memory: 'backend="memory"',
  redis: 'backend="redis"',
  "memory+redis": 'backend="memory+redis"',
} as const;

const CACHE_FAST_PATH_OPERATION_LABELS = {
  memory: 'backend="memory",operation="read",outcome="success"',
  redis: 'backend="redis",operation="read",outcome="success"',
  "memory+redis": 'backend="memory+redis",operation="read",outcome="success"',
} as const;

export function observeCacheFastPathRead(backend: "memory" | "redis" | "memory+redis"): void {
  increment(cacheFastPathReads, CACHE_FAST_PATH_LABELS[backend]);
  increment(cacheOperations, CACHE_FAST_PATH_OPERATION_LABELS[backend]);
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
    ...counterLines(
      "ssr_shell_dependency_total",
      "Shell dependency resolutions by stage and outcome",
      shellDependencies,
    ),
    ...shellDependencyDurations.lines(
      "ssr_shell_dependency_duration_milliseconds",
      "Shell dependency duration by stage and outcome",
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
      "ssr_cache_fast_path_reads_total",
      "Untraced L1-fresh-hit reads that bypassed the span/histogram path",
      cacheFastPathReads,
    ),
    ...counterLines(
      "ssr_cache_promotion_total",
      "L2 cache hits promoted into local L1",
      cachePromotions,
    ),
    ...labeledGaugeLines(
      "ssr_l1_cache_current_bytes",
      "Current L1 cache weight in bytes",
      l1CacheBytes,
    ),
    ...labeledGaugeLines("ssr_l1_cache_entries", "Current L1 cache entries", l1CacheEntries),
    ...counterLines(
      "ssr_l1_cache_evictions_total",
      "L1 cache evictions by namespace and reason",
      l1CacheEvictions,
    ),
    ...counterLines(
      "ssr_l1_cache_rejections_total",
      "L1 cache admission rejections by namespace and reason",
      l1CacheRejections,
    ),
    ...counterLines(
      "ssr_cached_resource_access_total",
      "Typed cached resource reads by state and result",
      cachedResourceAccesses,
    ),
    ...counterLines(
      "ssr_cached_resource_coalesced_total",
      "Typed cached resource operations joined behind process-local work",
      cachedResourceCoalescing,
    ),
    ...counterLines(
      "ssr_cached_resource_degradation_total",
      "Typed cached resource controlled degradation outcomes",
      cachedResourceDegradations,
    ),
    ...counterLines(
      "ssr_cached_resource_refresh_total",
      "Typed cached resource background refresh outcomes",
      cachedResourceRefreshes,
    ),
    ...cachedResourceRefreshDurations.lines(
      "ssr_cached_resource_refresh_duration_milliseconds",
      "Typed cached resource background refresh duration",
    ),
    ...counterLines(
      "ssr_fragment_access_total",
      "Fragment cache reads by declared fragment and state",
      fragmentAccesses,
    ),
    ...counterLines(
      "ssr_fragment_refresh_total",
      "Fragment background refresh outcomes",
      fragmentRefreshes,
    ),
    ...fragmentRefreshDurations.lines(
      "ssr_fragment_refresh_duration_milliseconds",
      "Fragment background refresh duration",
    ),
    ...counterLines(
      "ssr_fragment_fallback_total",
      "Fragment fallbacks by declared fragment and failure reason",
      fragmentFallbacks,
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
