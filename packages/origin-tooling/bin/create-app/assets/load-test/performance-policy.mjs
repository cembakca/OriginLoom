import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadPerformancePolicy(path = "performance-policy.json") {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

export async function inspectRoutePayloads(baseUrl, routes) {
  const results = [];
  for (const route of routes) {
    const response = await fetch(new URL(route.path, baseUrl), {
      redirect: "manual",
      headers: { accept: route.accept ?? "text/html", "accept-encoding": "identity" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    const htmlBytes = Buffer.byteLength(body);
    const islandProps = [...body.matchAll(/data-props="([^"]*)"/g)].map((match) =>
      Buffer.byteLength(match[1] ?? ""),
    );
    results.push({
      route: route.id,
      path: route.path,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      htmlBytes,
      islandCount: islandProps.length,
      islandPropsBytes: islandProps.reduce((total, value) => total + value, 0),
      largestIslandPropsBytes: Math.max(0, ...islandProps),
    });
  }
  return results;
}

export function evaluatePayloadBudgets(payloads, policy) {
  const limits = policy.payloadBudgets;
  const results = [];
  for (const payload of payloads) {
    for (const [metric, actual, maximum] of [
      ["htmlBytes", payload.htmlBytes, limits.htmlBytes],
      ["islandPropsBytes", payload.islandPropsBytes, limits.totalIslandPropsBytes],
      ["largestIslandPropsBytes", payload.largestIslandPropsBytes, limits.singleIslandPropsBytes],
    ]) {
      results.push({
        route: payload.route,
        metric,
        actual,
        maximum,
        passed: actual <= maximum,
      });
    }
  }
  return results;
}

export function evaluateRuntimeBudgets(aggregates, policy) {
  return aggregates.flatMap((group) =>
    [
      [
        "documentRenderP95Median",
        group.documentRenderP95Median,
        policy.payloadBudgets.documentRenderP95Ms,
      ],
      [
        "gatewayJsonParseP95Median",
        group.gatewayJsonParseP95Median,
        policy.payloadBudgets.gatewayJsonParseP95Ms,
      ],
    ].map(([metric, actual, maximum]) => ({
      route: group.route.id,
      connections: group.connections,
      metric,
      actual,
      maximum,
      passed: actual <= maximum,
    })),
  );
}

export function createPerformanceBaseline(report) {
  return {
    schemaVersion: 1,
    acceptedAt: new Date().toISOString(),
    environment: environmentFingerprint(report),
    config: comparableConfig(report),
    aggregates: report.aggregates.map((group) => ({
      route: group.route.id,
      connections: group.connections,
      rpsMedian: group.rpsMedian,
      latencyP97_5Median: group.latencyP97_5Median,
      latencyP99Median: group.latencyP99Median,
      rssPeakBytes: group.resource.rssPeakBytes,
      eventLoopP99PeakMs: group.resource.eventLoopP99PeakMs,
      documentRenderP95Median: group.documentRenderP95Median,
      gatewayJsonParseP95Median: group.gatewayJsonParseP95Median,
    })),
    payloads: report.payloads.map(
      ({ route, htmlBytes, islandPropsBytes, largestIslandPropsBytes }) => ({
        route,
        htmlBytes,
        islandPropsBytes,
        largestIslandPropsBytes,
      }),
    ),
  };
}

export function comparePerformance(report, baseline, policy) {
  const reliabilityIssues = report.aggregates
    .filter(
      (group) =>
        !group.valid ||
        group.rpsCvPercent > policy.reliability.maxCoefficientOfVariationPercent ||
        group.generatorCpuPercentMedian >= policy.reliability.generatorCpuLimitPercent,
    )
    .map((group) => {
      const reason = !group.valid
        ? "invalid"
        : group.rpsCvPercent > policy.reliability.maxCoefficientOfVariationPercent
          ? `CV ${group.rpsCvPercent.toFixed(1)}%`
          : `generator CPU ${group.generatorCpuPercentMedian.toFixed(1)}%`;
      return `${group.route.id} c=${group.connections}: ${reason}`;
    });
  if (reliabilityIssues.length) {
    return { status: "inconclusive", incompatibilities: reliabilityIssues, results: [] };
  }
  const incompatibilities = [];
  if (JSON.stringify(comparableConfig(report)) !== JSON.stringify(baseline.config)) {
    incompatibilities.push("profile/config mismatch");
  }
  const environment = environmentFingerprint(report);
  for (const key of ["platform", "arch", "nodeMajor", "logicalCpuCount"]) {
    if (environment[key] !== baseline.environment?.[key]) {
      incompatibilities.push(`${key}: ${baseline.environment?.[key]} -> ${environment[key]}`);
    }
  }
  if (incompatibilities.length) return { status: "incompatible", incompatibilities, results: [] };

  const results = [];
  const regression = policy.regression;
  for (const current of report.aggregates) {
    const previous = baseline.aggregates.find(
      (entry) => entry.route === current.route.id && entry.connections === current.connections,
    );
    if (!previous) continue;
    addRegression(
      results,
      current.route.id,
      current.connections,
      "rpsMedian",
      previous.rpsMedian,
      current.rpsMedian,
      regression.rpsMedianDropPercent,
      "decrease",
    );
    addRegression(
      results,
      current.route.id,
      current.connections,
      "latencyP97_5Median",
      previous.latencyP97_5Median,
      current.latencyP97_5Median,
      regression.latencyP97_5IncreasePercent,
      "increase",
    );
    addRegression(
      results,
      current.route.id,
      current.connections,
      "latencyP99Median",
      previous.latencyP99Median,
      current.latencyP99Median,
      regression.latencyP99IncreasePercent,
      "increase",
    );
    addRegression(
      results,
      current.route.id,
      current.connections,
      "rssPeakBytes",
      previous.rssPeakBytes,
      current.resource.rssPeakBytes,
      regression.rssPeakIncreasePercent,
      "increase",
    );
    addRegression(
      results,
      current.route.id,
      current.connections,
      "eventLoopP99PeakMs",
      previous.eventLoopP99PeakMs,
      current.resource.eventLoopP99PeakMs,
      regression.eventLoopP99IncreasePercent,
      "increase",
    );
    addRegression(
      results,
      current.route.id,
      current.connections,
      "documentRenderP95Median",
      previous.documentRenderP95Median,
      current.documentRenderP95Median,
      regression.serializationIncreasePercent,
      "increase",
    );
    addRegression(
      results,
      current.route.id,
      current.connections,
      "gatewayJsonParseP95Median",
      previous.gatewayJsonParseP95Median,
      current.gatewayJsonParseP95Median,
      regression.serializationIncreasePercent,
      "increase",
    );
  }
  for (const current of report.payloads) {
    const previous = baseline.payloads.find((entry) => entry.route === current.route);
    if (!previous) continue;
    for (const metric of ["htmlBytes", "islandPropsBytes", "largestIslandPropsBytes"]) {
      addRegression(
        results,
        current.route,
        null,
        metric,
        previous[metric],
        current[metric],
        regression.payloadIncreasePercent,
        "increase",
      );
    }
  }
  return {
    status: results.some(({ passed }) => !passed) ? "failed" : "passed",
    incompatibilities,
    results,
  };
}

export async function readBaseline(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return null;
  return JSON.parse(await readFile(absolute, "utf8"));
}

export async function writeBaseline(report, path, policy) {
  if (report.config.profile !== "full" || report.config.repeats < 3) {
    throw new Error("only a full profile with at least three repeats can become the baseline");
  }
  if (policy) {
    const issues = baselineAcceptanceIssues(report, policy);
    if (issues.length)
      throw new Error(`report cannot become performance baseline: ${issues.join(", ")}`);
  }
  const baseline = createPerformanceBaseline(report);
  await writeFile(resolve(path), `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return baseline;
}

export function baselineAcceptanceIssues(report, policy) {
  const issues = [];
  if (!report.cacheAcceptance?.passed) issues.push("cache correctness matrix missing or failed");
  const aggregates = Array.isArray(report.aggregates) ? report.aggregates : [];
  if (!aggregates.length) issues.push("aggregate measurements missing");
  if (aggregates.some((group) => !group.valid)) issues.push("invalid measurement");
  if (
    aggregates.some(
      (group) => group.rpsCvPercent > policy.reliability.maxCoefficientOfVariationPercent,
    )
  ) {
    issues.push("unstable measurement");
  }
  if (
    aggregates.some(
      (group) => group.generatorCpuPercentMedian >= policy.reliability.generatorCpuLimitPercent,
    )
  ) {
    issues.push("load generator CPU limit reached");
  }
  for (const [label, results] of [
    ["cache experiments", report.cacheExperiments],
    ["payload budgets", report.payloadBudgetResults],
    ["runtime budgets", report.runtimeBudgetResults],
  ]) {
    if (!Array.isArray(results) || results.length === 0) issues.push(`${label} missing`);
    else if (results.some(({ passed }) => !passed)) issues.push(`${label} failed`);
  }
  return issues;
}

function addRegression(
  results,
  route,
  connections,
  metric,
  previous,
  current,
  limitPercent,
  direction,
) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return;
  const changePercent = ((current - previous) / previous) * 100;
  const passed =
    direction === "decrease" ? changePercent >= -limitPercent : changePercent <= limitPercent;
  results.push({
    route,
    connections,
    metric,
    previous,
    current,
    changePercent,
    limitPercent,
    direction,
    passed,
  });
}

function comparableConfig(report) {
  return {
    profile: report.config.profile,
    connections: report.config.connections,
    durationSeconds: report.config.durationSeconds,
    repeats: report.config.repeats,
    warmupSeconds: report.config.warmupSeconds,
    routes: report.config.routes,
    gatewayDelayMs: report.environment.gatewayDelayMs,
    cacheTopology: report.environment.cacheTopology ?? "memory",
    compressionProfile: report.environment.compressionProfile ?? "identity",
  };
}

function environmentFingerprint(report) {
  return {
    platform: report.environment.platform,
    arch: report.environment.arch,
    nodeMajor: Number(/^v?(\d+)/.exec(report.environment.node)?.[1] ?? 0),
    logicalCpuCount: report.environment.logicalCpuCount,
  };
}
