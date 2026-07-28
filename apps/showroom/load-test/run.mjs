#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAutocannon } from "./lib/autocannon-run.mjs";
import { scrapeMetrics } from "./lib/metrics-snapshot.mjs";
import { writeReport } from "./lib/report.mjs";
import { startLoadTestStack, stopLoadTestStack } from "./lib/stack.mjs";
import { sampleResponseHeaders, sleep, waitForHealthy } from "./lib/util.mjs";
import { mixedPaths, scenarios } from "./scenarios.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loadTestDir = path.join(rootDir, "load-test");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node load-test/run.mjs [options]

Options:
  --profile memory|redis   Cache profili (default: memory)
  --quick                  Kısa senaryo alt kümesi (~5 dk)
  --skip-build             Docker image build atla
  --keep-stack             Test sonrası compose stack'i ayakta bırak

Env:
  LOADTEST_APP_PORT        Public port (default: 31005)
  LOADTEST_METRICS_PORT    Metrics port (default: 31090)

Örnek:
  npm run loadtest:memory
  npm run loadtest:redis -- --quick --skip-build
  npm run loadtest:memory -- --keep-stack && npm run pentest:readiness:loadtest
`);
  process.exit(0);
}

const profile = readFlag(args, "--profile") ?? "memory";
const quick = args.includes("--quick");
const skipBuild = args.includes("--skip-build");
const keepStack = args.includes("--keep-stack");

if (!["memory", "redis"].includes(profile)) {
  console.error(
    "Usage: node load-test/run.mjs --profile memory|redis [--quick] [--skip-build] [--keep-stack]",
  );
  process.exit(1);
}

const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, "-");
const outputDir = path.join(loadTestDir, "results", `${stamp}-${profile}`);

/** @type {string[] | null} */
let composeArgs = null;

try {
  await mkdir(outputDir, { recursive: true });

  console.log(`\n[origin-loom loadtest] profile=${profile} limits=2cpu/4GiB\n`);
  if (!skipBuild) console.log("[loadtest] Building production image...");
  console.log("[loadtest] Starting docker stack...");
  const stack = await startLoadTestStack(profile, { skipBuild });
  composeArgs = stack.composeArgs;
  const { appUrl, metricsUrl } = stack;

  console.log("[loadtest] Waiting for health/readiness...");
  await waitForHealthy(appUrl, { timeoutMs: 180_000 });

  const headerSample = await sampleResponseHeaders(`${appUrl}/`);
  await writeFile(
    path.join(outputDir, "preflight.json"),
    `${JSON.stringify({ appUrl, metricsUrl, headerSample }, null, 2)}\n`,
  );

  const metricsBefore = await scrapeMetrics(metricsUrl);
  const selectedScenarios = quick
    ? scenarios.filter((scenario) =>
        ["warmup-health", "cache-hit-home", "cache-bypass-calculator", "capacity-ramp"].includes(
          scenario.id,
        ),
      )
    : scenarios;

  /** @type {object[]} */
  const results = [];

  for (const scenario of selectedScenarios) {
    if (scenario.warmupSec) {
      console.log(`[loadtest] Warmup ${scenario.id} (${scenario.warmupSec}s)...`);
      await runAutocannon({
        url: `${appUrl}${scenario.path}`,
        scenario: {
          ...scenario,
          durationSec: scenario.warmupSec,
          connections: Math.min(10, scenario.connections),
        },
      });
      await sleep(2_000);
    }

    console.log(`\n[loadtest] Scenario ${scenario.id}: ${scenario.description}`);
    const targetUrl = `${appUrl}${scenario.path}`;
    const result = await runAutocannon({
      url: targetUrl,
      scenario,
      ...(scenario.id === "mixed-catalog"
        ? { urls: mixedPaths.map((entry) => `${appUrl}${entry}`) }
        : {}),
    });

    if (scenario.expectCache) {
      const sample = await sampleResponseHeaders(targetUrl);
      result.observedCache = sample.cache;
      result.expectedCache = scenario.expectCache;
    }

    results.push(result);

    if (scenario.cooldownSec) await sleep(scenario.cooldownSec * 1_000);
    else await sleep(3_000);
  }

  const metricsAfter = await scrapeMetrics(metricsUrl);
  const finishedAt = new Date().toISOString();

  await writeReport({
    outputDir,
    profile,
    suite: "benchmark",
    meta: {
      startedAt,
      finishedAt,
      appUrl,
      metricsUrl,
      quick,
      resourceLimits: "2 vCPU / 4 GiB (app)",
    },
    results,
    metricsBefore,
    metricsAfter,
  });

  console.log(`\n[loadtest] Report written to ${outputDir}/report.md`);
  printSummary(results);
} finally {
  if (composeArgs) {
    if (keepStack) console.log("[loadtest] Stack left running (--keep-stack)");
    else {
      console.log("[loadtest] Tearing down docker stack...");
      await stopLoadTestStack(composeArgs, false);
    }
  }
}

/**
 * @param {string[]} argv
 * @param {string} flag
 */
function readFlag(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1];
}

/** @param {object[]} results */
function printSummary(results) {
  console.log("\nScenario summary:");
  for (const result of results) {
    console.log(
      `- ${result.id}: ${result.requests.average} req/s, p99 ${result.latency.p99} ms, errors ${result.errors.ratePct}%`,
    );
  }
}
