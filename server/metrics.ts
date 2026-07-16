type CounterMap = Map<string, number>;

const requests: CounterMap = new Map();
const gatewayRequests: CounterMap = new Map();
let requestDurationMs = 0;
let gatewayDurationMs = 0;

function increment(map: CounterMap, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function statusClass(status: number): string {
  return status === 0 ? "error" : `${Math.floor(status / 100)}xx`;
}

export function observeRequest(status: number, cacheState: string, durationMs: number): void {
  const knownCacheStates = new Set(["HIT", "MISS", "STALE", "BYPASS", "ERROR", "NONE"]);
  const cache = knownCacheStates.has(cacheState) ? cacheState : "NONE";
  increment(requests, `${statusClass(status)}\0${cache}`);
  requestDurationMs += durationMs;
}

export function observeGatewayRequest(status: number, durationMs: number): void {
  increment(gatewayRequests, statusClass(status));
  gatewayDurationMs += durationMs;
}

function counterLines(
  name: string,
  help: string,
  map: CounterMap,
  labels: (key: string) => string,
): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const [key, value] of [...map.entries()].sort()) {
    lines.push(`${name}{${labels(key)}} ${value}`);
  }
  return lines;
}

export function renderMetrics(): string {
  const lines = [
    ...counterLines("ssr_http_requests_total", "HTTP requests", requests, (key) => {
      const [status, cache] = key.split("\0");
      return `status_class="${status}",cache="${cache}"`;
    }),
    "# HELP ssr_http_request_duration_milliseconds_total Cumulative HTTP request time",
    "# TYPE ssr_http_request_duration_milliseconds_total counter",
    `ssr_http_request_duration_milliseconds_total ${requestDurationMs.toFixed(3)}`,
    ...counterLines(
      "ssr_gateway_requests_total",
      "Gateway requests",
      gatewayRequests,
      (key) => `status_class="${key}"`,
    ),
    "# HELP ssr_gateway_request_duration_milliseconds_total Cumulative gateway request time",
    "# TYPE ssr_gateway_request_duration_milliseconds_total counter",
    `ssr_gateway_request_duration_milliseconds_total ${gatewayDurationMs.toFixed(3)}`,
  ];
  return `${lines.join("\n")}\n`;
}
