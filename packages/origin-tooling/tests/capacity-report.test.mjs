import { describe, expect, it } from "vitest";

import {
  histogramDelta,
  metricDelta,
  parsePrometheus,
  sumMetric,
} from "../bin/create-app/assets/load-test/capacity-metrics.mjs";
import {
  aggregateRuns,
  analyzeCapacity,
} from "../bin/create-app/assets/load-test/capacity-report.mjs";
import {
  baselineAcceptanceIssues,
  comparePerformance,
  createPerformanceBaseline,
  evaluatePayloadBudgets,
} from "../bin/create-app/assets/load-test/performance-policy.mjs";

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

  it("calculates a histogram quantile from counter deltas", () => {
    const before = parsePrometheus(`
metric_bucket{kind="document_render",le="10"} 2
metric_bucket{kind="document_render",le="50"} 3
metric_bucket{kind="document_render",le="+Inf"} 3
metric_sum{kind="document_render"} 30
metric_count{kind="document_render"} 3
`);
    const after = parsePrometheus(`
metric_bucket{kind="document_render",le="10"} 10
metric_bucket{kind="document_render",le="50"} 13
metric_bucket{kind="document_render",le="+Inf"} 13
metric_sum{kind="document_render"} 150
metric_count{kind="document_render"} 13
`);
    expect(histogramDelta(before, after, "metric", { kind: "document_render" }, 0.95)).toEqual({
      count: 10,
      average: 12,
      quantile: 50,
    });
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

  it("enforces payload budgets and detects comparable baseline regressions", () => {
    const report = reportFixture();
    const policy = {
      payloadBudgets: {
        htmlBytes: 100_000,
        totalIslandPropsBytes: 50_000,
        singleIslandPropsBytes: 20_000,
      },
      regression: {
        rpsMedianDropPercent: 10,
        latencyP97_5IncreasePercent: 20,
        latencyP99IncreasePercent: 25,
        rssPeakIncreasePercent: 20,
        eventLoopP99IncreasePercent: 25,
        serializationIncreasePercent: 20,
        payloadIncreasePercent: 10,
      },
      reliability: { maxCoefficientOfVariationPercent: 10, generatorCpuLimitPercent: 90 },
    };
    expect(evaluatePayloadBudgets(report.payloads, policy).every(({ passed }) => passed)).toBe(
      true,
    );
    const baseline = createPerformanceBaseline(report);
    report.aggregates[0].rpsMedian = 800;
    const comparison = comparePerformance(report, baseline, policy);
    expect(comparison.status).toBe("failed");
    expect(comparison.results).toContainEqual(
      expect.objectContaining({ metric: "rpsMedian", passed: false, changePercent: -20 }),
    );
  });

  it("rejects unreliable or hard-budget-failing baseline candidates", () => {
    const report = reportFixture();
    const policy = report.performancePolicy;
    expect(baselineAcceptanceIssues(report, policy)).toEqual([]);

    report.aggregates[0].generatorCpuPercentMedian = policy.reliability.generatorCpuLimitPercent;
    report.payloadBudgetResults[0].passed = false;

    expect(baselineAcceptanceIssues(report, policy)).toEqual([
      "load generator CPU limit reached",
      "payload budgets failed",
    ]);
    const baseline = createPerformanceBaseline(reportFixture());
    expect(comparePerformance(report, baseline, policy)).toEqual(
      expect.objectContaining({ status: "inconclusive" }),
    );
  });

  it("keeps cache topology and compression profiles out of the same baseline", () => {
    const report = reportFixture();
    const baseline = createPerformanceBaseline(report);
    report.environment.compressionProfile = "gzip";

    expect(comparePerformance(report, baseline, report.performancePolicy)).toEqual(
      expect.objectContaining({ status: "incompatible" }),
    );
  });
});

function reportFixture() {
  return {
    environment: {
      platform: "darwin",
      arch: "arm64",
      node: "v22.20.0",
      logicalCpuCount: 8,
      gatewayDelayMs: 0,
    },
    config: {
      profile: "full",
      connections: [10],
      durationSeconds: 60,
      repeats: 3,
      warmupSeconds: 30,
      routes: ["catalog"],
    },
    aggregates: [
      {
        route,
        connections: 10,
        valid: true,
        rpsCvPercent: 0,
        generatorCpuPercentMedian: 30,
        rpsMedian: 1_000,
        latencyP97_5Median: 10,
        latencyP99Median: 15,
        documentRenderP95Median: 5,
        gatewayJsonParseP95Median: 1,
        resource: { rssPeakBytes: 100_000_000, eventLoopP99PeakMs: 5 },
      },
    ],
    payloads: [
      {
        route: "catalog",
        htmlBytes: 20_000,
        islandPropsBytes: 2_000,
        largestIslandPropsBytes: 1_000,
      },
    ],
    cacheExperiments: [{ passed: true }],
    cacheAcceptance: { passed: true, topologies: [] },
    payloadBudgetResults: [{ passed: true }],
    runtimeBudgetResults: [{ passed: true }],
    performancePolicy: {
      payloadBudgets: {
        htmlBytes: 100_000,
        totalIslandPropsBytes: 50_000,
        singleIslandPropsBytes: 20_000,
      },
      regression: {
        rpsMedianDropPercent: 10,
        latencyP97_5IncreasePercent: 20,
        latencyP99IncreasePercent: 25,
        rssPeakIncreasePercent: 20,
        eventLoopP99IncreasePercent: 25,
        serializationIncreasePercent: 20,
        payloadIncreasePercent: 10,
      },
      reliability: { maxCoefficientOfVariationPercent: 10, generatorCpuLimitPercent: 90 },
    },
  };
}
