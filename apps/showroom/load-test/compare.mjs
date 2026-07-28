#!/usr/bin/env node
/**
 * İki load/stress raporunu (memory vs redis) yan yana karşılaştırır.
 *
 * Usage:
 *   node load-test/compare.mjs --latest
 *   node load-test/compare.mjs --latest --stress
 *   node load-test/compare.mjs <memory-results.json> <redis-results.json>
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const loadTestDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const resultsDir = path.join(loadTestDir, "results");
const args = process.argv.slice(2);
const stress = args.includes("--stress");
const positional = args.filter((arg) => !arg.startsWith("--"));

let memoryPath;
let redisPath;

if (positional.length === 0 || args.includes("--latest")) {
  memoryPath = await findLatest("memory", stress ? "stress" : "benchmark");
  redisPath = await findLatest("redis", stress ? "stress" : "benchmark");
  if (!memoryPath || !redisPath) {
    console.error(
      `En az bir memory ve bir redis results.json gerekli (suite=${stress ? "stress" : "benchmark"}).`,
    );
    process.exit(1);
  }
} else if (positional.length >= 2) {
  memoryPath = path.resolve(positional[0]);
  redisPath = path.resolve(positional[1]);
} else {
  console.error(
    "Usage: node load-test/compare.mjs [--latest] [--stress] | <memory.json> <redis.json>",
  );
  process.exit(1);
}

const memory = JSON.parse(await readFile(memoryPath, "utf8"));
const redis = JSON.parse(await readFile(redisPath, "utf8"));
const memoryById = indexById(memory.results);
const redisById = indexById(redis.results);
const ids = [...new Set([...Object.keys(memoryById), ...Object.keys(redisById)])].sort();

console.log(`\n# memory vs redis (${stress ? "stress" : "benchmark"})\n`);
console.log(`| memory | ${memoryPath} |`);
console.log(`| redis  | ${redisPath} |\n`);
console.log(
  "| Senaryo | memory RPS | redis RPS | Δ RPS % | memory p99 | redis p99 | Δ p99 % | memory err% | redis err% |",
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");

for (const id of ids) {
  const m = memoryById[id];
  const r = redisById[id];
  if (!m || !r) {
    console.log(`| ${id} | — | — | — | — | — | — | — | — |`);
    continue;
  }
  console.log(
    `| ${id} | ${m.requests.average} | ${r.requests.average} | ${deltaPct(m.requests.average, r.requests.average)} | ${m.latency.p99} | ${r.latency.p99} | ${deltaPct(m.latency.p99, r.latency.p99)} | ${m.errors.ratePct} | ${r.errors.ratePct} |`,
  );
}

console.log("");

/**
 * @param {string} profile
 * @param {"benchmark" | "stress"} suite
 */
async function findLatest(profile, suite) {
  const entries = await readdir(resultsDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && matchesSuite(entry.name, profile, suite))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = path.join(resultsDir, dir, "results.json");
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // incomplete run
    }
  }
  return undefined;
}

/**
 * @param {string} name
 * @param {string} profile
 * @param {"benchmark" | "stress"} suite
 */
function matchesSuite(name, profile, suite) {
  if (suite === "stress") return name.endsWith(`-stress-${profile}`);
  return name.endsWith(`-${profile}`) && !name.includes("-stress-");
}

/** @param {object[]} results */
function indexById(results) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const result of results ?? []) out[result.id] = result;
  return out;
}

/** @param {number} base @param {number} next */
function deltaPct(base, next) {
  if (!base) return next ? "∞" : "0";
  return `${Math.round(((next - base) / base) * 100)}`;
}
