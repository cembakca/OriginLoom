import { monitorEventLoopDelay } from "node:perf_hooks";

import { isKnownPageCachePrefix, parseCacheKey } from "~/lib/cache-keys";

type CounterMap = Map<string, number>;
type GatewayOutcome = "success" | "client_error" | "server_error" | "timeout" | "network_error";
type OperationOutcome = "success" | "error";

class Histogram {
  private readonly values = new Map<string, { count: number; sum: number; buckets: number[] }>();

  constructor(private readonly boundaries: number[]) {}

  observe(labels: string, value: number): void {
    const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
    const current = this.values.get(labels) ?? {
      count: 0,
      sum: 0,
      buckets: this.boundaries.map(() => 0),
    };
    current.count++;
    current.sum += safeValue;
    for (let index = 0; index < this.boundaries.length; index++) {
      if (safeValue <= this.boundaries[index]!) {
        current.buckets[index] = (current.buckets[index] ?? 0) + 1;
      }
    }
    this.values.set(labels, current);
  }

  lines(name: string, help: string): string[] {
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
    for (const [labels, value] of [...this.values.entries()].sort()) {
      for (let index = 0; index < this.boundaries.length; index++) {
        lines.push(
          `${name}_bucket{${labels},le="${this.boundaries[index]}"} ${value.buckets[index]}`,
        );
      }
      lines.push(`${name}_bucket{${labels},le="+Inf"} ${value.count}`);
      lines.push(`${name}_sum{${labels}} ${finite(value.sum)}`);
      lines.push(`${name}_count{${labels}} ${value.count}`);
    }
    return lines;
  }
}

const DURATION_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];
const BODY_SIZE_BUCKETS_BYTES = [1_024, 10_240, 51_200, 102_400, 262_144, 524_288, 1_048_576];
const KEY_SIZE_BUCKETS_BYTES = [32, 64, 128, 256, 512, 1_024];
const MAX_DISTINCT_KEYS_PER_ROUTE = 2_000;
const requests: CounterMap = new Map();
const gatewayRequests: CounterMap = new Map();
const cacheOperations: CounterMap = new Map();
const revalidations: CounterMap = new Map();
const cacheCardinalityOverflows: CounterMap = new Map();
const invalidGatewayPayloads: CounterMap = new Map();
const shellDegradations: CounterMap = new Map();
const distinctCacheKeys = new Map<string, Set<string>>();
const requestDurations = new Histogram(DURATION_BUCKETS_MS);
const cacheResponseDurations = new Histogram(DURATION_BUCKETS_MS);
const gatewayDurations = new Histogram(DURATION_BUCKETS_MS);
const cacheDurations = new Histogram(DURATION_BUCKETS_MS);
const revalidationDurations = new Histogram(DURATION_BUCKETS_MS);
const cacheBodySizes = new Histogram(BODY_SIZE_BUCKETS_BYTES);
const cacheKeySizes = new Histogram(KEY_SIZE_BUCKETS_BYTES);
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function increment(map: CounterMap, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function statusClass(status: number): string {
  return status === 0 ? "error" : `${Math.floor(status / 100)}xx`;
}

export function observeRequest(status: number, cacheState: string, durationMs: number): void {
  const knownCacheStates = new Set([
    "HIT",
    "MISS",
    "STALE",
    "BYPASS",
    "ERROR",
    "NONE",
    "REDIRECT",
    "PROXY",
  ]);
  const cache = knownCacheStates.has(cacheState) ? cacheState : "NONE";
  const labels = `status_class="${statusClass(status)}",cache="${cache}"`;
  increment(requests, labels);
  requestDurations.observe(labels, durationMs);
  if (cache === "HIT" || cache === "MISS" || cache === "STALE") {
    cacheResponseDurations.observe(`state="${cache}"`, durationMs);
  }
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

export function observeShellDegradation(
  component: "menu",
  reason: "gateway_error" | "invalid_payload",
): void {
  increment(shellDegradations, `component="${component}",reason="${reason}"`);
}

export function observeCacheOperation(
  backend: "memory" | "redis",
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

function counterLines(name: string, help: string, map: CounterMap): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const [labels, value] of [...map.entries()].sort()) {
    lines.push(`${name}{${labels}} ${value}`);
  }
  return lines;
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

function gauge(name: string, help: string, value: number, labels?: string): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}${labels ? `{${labels}}` : ""} ${finite(value)}`,
  ];
}

export function renderMetrics(): string {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const release = escapeLabel(process.env.RELEASE_ID ?? "development");
  const service = escapeLabel(process.env.OTEL_SERVICE_NAME ?? "ssr-kit");
  const eventLoopScale = 1e6;

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
    ...counterLines(
      "ssr_shell_degraded_total",
      "Non-critical shell components rendered with controlled fallback data",
      shellDegradations,
    ),
    ...gatewayDurations.lines(
      "ssr_gateway_request_duration_milliseconds",
      "Gateway request duration",
    ),
    ...counterLines("ssr_cache_operations_total", "Cache operations by backend", cacheOperations),
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
    ...gauge(
      "ssr_event_loop_lag_p50_seconds",
      "Event loop delay p50",
      eventLoopDelay.percentile(50) / eventLoopScale / 1_000,
    ),
    ...gauge(
      "ssr_event_loop_lag_p95_seconds",
      "Event loop delay p95",
      eventLoopDelay.percentile(95) / eventLoopScale / 1_000,
    ),
    ...gauge(
      "ssr_event_loop_lag_p99_seconds",
      "Event loop delay p99",
      eventLoopDelay.percentile(99) / eventLoopScale / 1_000,
    ),
    ...gauge("process_resident_memory_bytes", "Resident memory size", memory.rss),
    ...gauge("process_heap_used_bytes", "Process heap used", memory.heapUsed),
    ...gauge("process_uptime_seconds", "Process uptime", process.uptime()),
    ...gauge("process_cpu_user_seconds_total", "Total user CPU time", cpu.user / 1e6),
    ...gauge("process_cpu_system_seconds_total", "Total system CPU time", cpu.system / 1e6),
    ...gauge(
      "ssr_release_info",
      "Build and service identity",
      1,
      `service="${service}",release="${release}"`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

function finite(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function cacheRouteLabel(key: string): string {
  const prefix = parseCacheKey(key)[0] ?? "other";
  if (isKnownPageCachePrefix(prefix)) return prefix;
  if (prefix.startsWith("menu:")) return "menu";
  return "other";
}
