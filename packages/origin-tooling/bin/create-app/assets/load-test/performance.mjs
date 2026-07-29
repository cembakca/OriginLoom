#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  comparePerformance,
  loadPerformancePolicy,
  readBaseline,
  writeBaseline,
} from "./performance-policy.mjs";

const options = parseArgs(process.argv.slice(2));
const report = JSON.parse(await readFile(resolve(options.report), "utf8"));
const policy = await loadPerformancePolicy(options.policy);
if (options.accept) {
  try {
    await writeBaseline(report, options.baseline, policy);
    console.log(`✓ performance baseline accepted: ${resolve(options.baseline)}`);
    process.exit(0);
  } catch (error) {
    console.error(
      `✗ baseline not accepted: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const baseline = await readBaseline(options.baseline);
if (!baseline) {
  console.error(
    `✗ baseline not found: ${resolve(options.baseline)}\nRun pnpm performance:accept after reviewing a stable full report.`,
  );
  process.exit(1);
}
const comparison = comparePerformance(report, baseline, policy);
if (comparison.status === "incompatible") {
  console.error(`✗ incompatible report: ${comparison.incompatibilities.join(", ")}`);
  process.exit(1);
}
if (comparison.status === "inconclusive") {
  console.error(`✗ inconclusive report: ${comparison.incompatibilities.join(", ")}`);
  process.exit(1);
}
for (const result of comparison.results) {
  const sign = result.changePercent >= 0 ? "+" : "";
  console.log(
    `${result.passed ? "✓" : "✗"} ${result.route}${result.connections ? ` c=${result.connections}` : ""} ${result.metric}: ${sign}${result.changePercent.toFixed(1)}%`,
  );
}
if (comparison.status === "failed") process.exitCode = 1;

function parseArgs(argv) {
  const parsed = {
    report: "load-test/reports/latest.json",
    baseline: "performance-baseline.json",
    policy: "performance-policy.json",
    accept: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--report") parsed.report = argv[++index];
    else if (arg === "--baseline") parsed.baseline = argv[++index];
    else if (arg === "--policy") parsed.policy = argv[++index];
    else if (arg === "--accept") parsed.accept = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}
