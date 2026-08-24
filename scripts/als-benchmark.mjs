#!/usr/bin/env node
/**
 * What Node 24's `AsyncContextFrame` actually bought us.
 *
 * Every request in this platform runs inside one `AsyncLocalStorage` store, and
 * `memoizeRequestValue`, the request id, `after()` and the diagnostics trace all
 * read it. Node 24 changed how that store is carried — from `async_hooks` to
 * `AsyncContextFrame` — and § 9.2 of the research doc claimed the win was
 * already ours and only needed measuring. This is the measurement.
 *
 * Deliberately a microbenchmark and not a capacity run. A capacity run answers
 * "how many requests per second", which depends on a gateway, a cache topology
 * and a machine; this answers the narrower question the claim was about — what
 * one store entry and one store read cost — and it is the only part a Node
 * version change can move on its own.
 *
 *   node scripts/als-benchmark.mjs            # one runtime
 *   node scripts/als-benchmark.mjs --json     # machine-readable, for comparing
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();
const asJson = process.argv.includes("--json");

/** Mirrors the real shape: an id, a memo map and a task list. */
const state = () => ({ requestId: "bench", memo: new Map(), after: [] });

async function shallow() {
  return storage.run(state(), async () => storage.getStore()?.requestId);
}

/** A render is nested awaits, and the store has to survive every one of them. */
async function nested(depth) {
  return storage.run(state(), async () => {
    for (let level = 0; level < depth; level++) await Promise.resolve();
    return storage.getStore()?.requestId;
  });
}

/** The read a memoized loader does, with no new store. */
async function read() {
  return storage.getStore()?.requestId;
}

async function measure(name, work, iterations) {
  // Warm up so the first pass is not measuring the optimizer.
  for (let i = 0; i < Math.min(iterations, 20_000); i++) await work();
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) await work();
  const nanoseconds = Number(process.hrtime.bigint() - started);
  return { name, iterations, nsPerOp: nanoseconds / iterations };
}

const results = [
  await measure("run + get (flat)", shallow, 300_000),
  await measure("run + 10 awaits + get", () => nested(10), 100_000),
  await measure("get, no store", read, 500_000),
];

const report = { node: process.version, results };
if (asJson) {
  console.log(JSON.stringify(report));
} else {
  console.log(`node ${report.node}`);
  for (const { name, nsPerOp } of results) {
    console.log(`  ${name.padEnd(24)} ${nsPerOp.toFixed(1).padStart(8)} ns/op`);
  }
}
