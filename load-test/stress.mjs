#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scrapeMetrics } from "./lib/metrics-snapshot.mjs";
import { writeReport } from "./lib/report.mjs";
import { startLoadTestStack, stopLoadTestStack } from "./lib/stack.mjs";
import { runStressScenario } from "./lib/stress-runner.mjs";
import { sleep, waitForHealthy } from "./lib/util.mjs";
import { stressQuickIds, stressScenarios } from "./stress-scenarios.mjs";

const loadTestDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node load-test/stress.mjs [options]

Ciddi stres suite — SSR capacity (503) ve deadline (504) sinyallerini bilinçli üretir.
App container: 2 vCPU / 4 GiB. Toplam süre ~25–40 dk (quick ~12–18 dk).

Options:
  --profile memory|redis   Cache profili (default: memory)
  --quick                  Alt küme (saturation + ramp + recovery)
  --skip-build             Docker image build atla
  --keep-stack             Stack'i ayakta bırak

Örnek:
  npm run stress:memory
  npm run stress:redis -- --quick --skip-build
`);
  process.exit(0);
}

const profile = readFlag(args, "--profile") ?? "memory";
const quick = args.includes("--quick");
const skipBuild = args.includes("--skip-build");
const keepStack = args.includes("--keep-stack");

if (!["memory", "redis"].includes(profile)) {
  console.error("Geçersiz profil. --profile memory|redis");
  process.exit(1);
}

const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, "-");
const outputDir = path.join(loadTestDir, "results", `${stamp}-stress-${profile}`);

/** @type {string[] | null} */
let composeArgs = null;

try {
  await mkdir(outputDir, { recursive: true });
  console.log(`\n[ssr-kit stress] profile=${profile} limits=2cpu/4GiB suite=stress\n`);

  const stack = await startLoadTestStack(profile, { skipBuild });
  composeArgs = stack.composeArgs;
  const { appUrl, metricsUrl } = stack;

  console.log("[stress] Waiting for health/readiness...");
  await waitForHealthy(appUrl, { timeoutMs: 180_000 });

  await writeFile(
    path.join(outputDir, "preflight.json"),
    `${JSON.stringify(
      {
        suite: "stress",
        appUrl,
        metricsUrl,
        ssrLimits: { maxConcurrency: 32, maxQueue: 64, queueWaitMs: 250 },
      },
      null,
      2,
    )}\n`,
  );

  let selected = quick
    ? stressScenarios.filter((scenario) => stressQuickIds.includes(scenario.id))
    : stressScenarios;

  selected = selected.map((scenario) => applyQuickOverrides(scenario, quick));

  const metricsBefore = await scrapeMetrics(metricsUrl);
  /** @type {object[]} */
  const results = [];

  for (const scenario of selected) {
    if (scenario.warmupSec) {
      console.log(`[stress] Warmup ${scenario.id} (${scenario.warmupSec}s)...`);
      await runStressScenario({
        appUrl,
        scenario: {
          ...scenario,
          id: `${scenario.id}-warmup`,
          durationSec: scenario.warmupSec,
          connections: Math.min(16, scenario.connections),
          phases: undefined,
          urlFactory: undefined,
        },
      });
      await sleep(3_000);
    }

    console.log(`\n[stress] ${scenario.id}: ${scenario.description}`);
    const scenarioResults = await runStressScenario({ appUrl, scenario });
    for (const result of scenarioResults) {
      if (scenario.expectRecovery) {
        result.expectRecovery = true;
        result.recoveryOk = result.errors.ratePct < 1 && !(result.statusCodes?.["503"] > 0);
      }
      results.push(result);
    }

    const cooldown = scenario.cooldownSec ?? 10;
    console.log(`[stress] Cooldown ${cooldown}s...`);
    await sleep(cooldown * 1_000);
  }

  const metricsAfter = await scrapeMetrics(metricsUrl);
  const finishedAt = new Date().toISOString();

  await writeReport({
    outputDir,
    profile,
    suite: "stress",
    meta: {
      startedAt,
      finishedAt,
      appUrl,
      metricsUrl,
      quick,
      resourceLimits: "2 vCPU / 4 GiB (app)",
      ssrLimits: "SSR_MAX_CONCURRENCY=32, SSR_MAX_QUEUE=64",
    },
    results,
    metricsBefore,
    metricsAfter,
  });

  console.log(`\n[stress] Report: ${outputDir}/report.md`);
  printSummary(results);
} finally {
  if (composeArgs) {
    if (keepStack) console.log("[stress] Stack left running (--keep-stack)");
    else {
      console.log("[stress] Tearing down docker stack...");
      await stopLoadTestStack(composeArgs, false);
    }
  }
}

/** @param {import("./stress-scenarios.mjs").StressScenario} scenario @param {boolean} quick */
function applyQuickOverrides(scenario, quick) {
  if (!quick) return scenario;
  if (scenario.id === "stress-ssr-saturation") {
    return { ...scenario, durationSec: 60, connections: 320 };
  }
  if (scenario.id === "stress-capacity-ramp" && scenario.phases) {
    return {
      ...scenario,
      phases: scenario.phases.filter((phase) => ["c192", "c384"].includes(phase.suffix ?? "")),
    };
  }
  return scenario;
}

/** @param {string[]} argv @param {string} flag */
function readFlag(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1];
}

/** @param {object[]} results */
function printSummary(results) {
  console.log("\nStress summary:");
  for (const result of results) {
    const codes = result.statusCodes ?? {};
    const serverErrors = Object.entries(codes)
      .filter(([code]) => Number(code) >= 500)
      .map(([code, count]) => `${code}:${count}`)
      .join(", ");
    const recovery = result.expectRecovery
      ? result.recoveryOk
        ? " recovery=ok"
        : " recovery=FAIL"
      : "";
    console.log(
      `- ${result.id}: ${result.requests.average} req/s, p99 ${result.latency.p99} ms, err ${result.errors.ratePct}%${serverErrors ? ` (${serverErrors})` : ""}${recovery}`,
    );
  }
}
