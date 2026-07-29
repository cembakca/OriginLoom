import { describe, expect, it } from "vitest";

import {
  metricDelta,
  parsePrometheus,
  sumMetric,
} from "../bin/create-app/assets/load-test/capacity-metrics.mjs";
import {
  aggregateRuns,
  analyzeCapacity,
} from "../bin/create-app/assets/load-test/capacity-report.mjs";

const route = {
  id: "catalog",
  title: "Catalog",
  path: "/catalog",
  category: "html-shared",
};

describe("capacity report helpers", () => {
  it("parses Prometheus labels and calculates counter deltas", () => {
    const before = parsePrometheus(`
# TYPE ssr_http_requests_total counter
ssr_http_requests_total{status_class="2xx",cache="HIT",route="/catalog"} 10
process_cpu_user_seconds_total 2.5
`);
    const after = parsePrometheus(`
ssr_http_requests_total{status_class="2xx",cache="HIT",route="/catalog"} 35
process_cpu_user_seconds_total 3.75
`);

    expect(sumMetric(after, "ssr_http_requests_total", { cache: "HIT" })).toBe(35);
    expect(metricDelta(before, after, "ssr_http_requests_total", { cache: "HIT" })).toBe(25);
    expect(metricDelta(before, after, "process_cpu_user_seconds_total")).toBe(1.25);
  });

  it("aggregates repeats and selects the stage before a saturation knee", () => {
    const run = (connections, rps, p99, eventLoop = 5) => ({
      route,
      connections,
      requests: rps * 10,
      requestsPerSecond: rps,
      valid: true,
      latency: { average: p99 / 2, p50: p99 / 3, p95: p99 * 0.8, p99, max: p99 * 2 },
      errors: 0,
      timeouts: 0,
      unexpectedStatuses: {},
      cacheStates: { HIT: rps * 10 },
      metrics: { gatewayRequests: 0, appCpuPercent: 90, generatorCpuPercent: 30 },
      resource: {
        rssPeakBytes: 100_000_000,
        heapPeakBytes: 50_000_000,
        eventLoopP95PeakMs: eventLoop / 2,
        eventLoopP99PeakMs: eventLoop,
      },
    });
    const aggregates = aggregateRuns([
      run(10, 1_000, 10),
      run(10, 1_100, 11),
      run(50, 3_000, 20),
      run(50, 3_100, 21),
      run(100, 3_150, 50),
      run(100, 3_200, 55),
    ]);

    const [analysis] = analyzeCapacity(aggregates);
    expect(analysis.recommended.connections).toBe(50);
    expect(analysis.knee.connections).toBe(100);
  });
});
