#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(HERE, "cache-worker.mjs");

export async function runCacheAcceptance(options = {}) {
  const topology = options.topology ?? "memory";
  const outputDirectory = resolve(options.outputDirectory ?? "load-test/reports");
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  if (!["memory", "redis", "both"].includes(topology)) {
    throw new Error(`unknown cache topology: ${topology}`);
  }
  if ((topology === "redis" || topology === "both") && !redisUrl?.trim()) {
    throw new Error("REDIS_URL is required for the Redis acceptance topology");
  }

  const startedAt = new Date().toISOString();
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const upstream = await startUpstream();
  const topologyReports = [];
  try {
    if (topology === "memory" || topology === "both") {
      topologyReports.push(await runMemoryMatrix(upstream));
    }
    if (topology === "redis" || topology === "both") {
      topologyReports.push(await runRedisMatrix(upstream, redisUrl));
    }
  } finally {
    await upstream.close();
    delay.disable();
  }

  const report = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedTopology: topology,
    passed: topologyReports.every(({ passed }) => passed),
    eventLoop: {
      p95Ms: nanosecondsToMs(delay.percentile(95)),
      p99Ms: nanosecondsToMs(delay.percentile(99)),
      maxMs: nanosecondsToMs(delay.max),
    },
    topologies: topologyReports,
  };
  await mkdir(outputDirectory, { recursive: true });
  const target = resolve(outputDirectory, `cache-acceptance-${topology}.json`);
  await Promise.all([
    writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(
      resolve(outputDirectory, "latest-cache-acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
  ]);
  return { report, path: target };
}

async function runMemoryMatrix(upstream) {
  const worker = await startWorker("memory", { required: false });
  const scenarios = [];
  try {
    scenarios.push(
      await scenario("cold burst", upstream, async () => {
        const before = upstream.total("memory-cold");
        const response = await worker.request(
          command("memory-cold", { ttl: 60 }, { operation: "burst", count: 32 }),
        );
        const calls = upstream.total("memory-cold") - before;
        return {
          passed: calls === 1 && response.results.every(({ cacheState }) => cacheState === "miss"),
          gatewayRequests: calls,
          requests: 32,
          latencyMs: response.elapsedMs,
          detail: `32 cold readers collapsed to ${calls} loader call(s)`,
        };
      }),
    );

    scenarios.push(
      await scenario("stale burst", upstream, async () => {
        const base = command("memory-stale", { ttl: 1, swr: 10 });
        await worker.request({ ...base, operation: "get", value: 1 });
        await wait(1_100);
        const before = upstream.total("memory-stale");
        const response = await worker.request({ ...base, operation: "burst", count: 32, value: 2 });
        await worker.request({ operation: "drain", timeoutMs: 3_000 });
        const calls = upstream.total("memory-stale") - before;
        return {
          passed: calls === 1 && response.results.every(({ cacheState }) => cacheState === "stale"),
          gatewayRequests: calls,
          requests: 32,
          latencyMs: response.elapsedMs,
          detail: `32 stale readers returned immediately and triggered ${calls} refresh`,
        };
      }),
    );

    scenarios.push(
      await scenario("negative cache", upstream, async () => {
        const base = command("memory-negative", { ttl: 60, negativeTtl: 10 });
        const before = upstream.total("memory-negative");
        const first = await worker.request({ ...base, operation: "get", mode: "not-found" });
        const second = await worker.request({ ...base, operation: "get", mode: "not-found" });
        const calls = upstream.total("memory-negative") - before;
        return {
          passed:
            calls === 1 &&
            first.result.kind === "not-found" &&
            first.result.cacheState === "miss" &&
            second.result.cacheState === "fresh",
          gatewayRequests: calls,
          requests: 2,
          latencyMs: first.elapsedMs + second.elapsedMs,
          detail: `two successful not-found reads used ${calls} loader call(s)`,
        };
      }),
    );

    scenarios.push(
      await scenario("stale-if-error", upstream, async () => {
        const base = command("memory-stale-error", { ttl: 1, staleIfError: 10 });
        await worker.request({ ...base, operation: "get", value: 1 });
        await wait(1_100);
        const response = await worker.request({ ...base, operation: "get", mode: "error" });
        return {
          passed: response.result.cacheState === "stale" && response.result.staleIfError === true,
          gatewayRequests: 1,
          requests: 1,
          latencyMs: response.elapsedMs,
          detail: "expired value survived a blocking upstream failure",
        };
      }),
    );

    scenarios.push(
      await scenario("byte eviction", upstream, async () => {
        const base = command("memory-bytes", { ttl: 60 });
        const before = upstream.total("memory-bytes");
        await worker.request({ ...base, operation: "get", parts: ["a"], bytes: 5_000 });
        await worker.request({ ...base, operation: "get", parts: ["b"], bytes: 5_000 });
        await worker.request({ ...base, operation: "get", parts: ["a"], bytes: 5_000 });
        const calls = upstream.total("memory-bytes") - before;
        return {
          passed: calls === 3,
          gatewayRequests: calls,
          requests: 3,
          latencyMs: undefined,
          detail: `bounded L1 reloaded the evicted value; loader calls=${calls}`,
        };
      }),
    );
  } finally {
    await worker.close();
  }
  return topologyReport("memory", scenarios);
}

async function runRedisMatrix(upstream, redisUrl) {
  const releaseId = `cache-acceptance-${Date.now()}-${process.pid}`;
  const workers = await Promise.all([
    startWorker("redis", { redisUrl, required: true, releaseId }),
    startWorker("redis", { redisUrl, required: true, releaseId }),
  ]);
  const [first, second] = workers;
  const scenarios = [];
  try {
    scenarios.push(
      await scenario("cross-process cold fill", upstream, async () => {
        const base = command("redis-cold", { ttl: 60 });
        const before = upstream.total("redis-cold");
        const responses = await Promise.all([
          first.request({ ...base, operation: "burst", count: 16 }),
          second.request({ ...base, operation: "burst", count: 16 }),
        ]);
        const calls = upstream.total("redis-cold") - before;
        return {
          passed: calls === 1,
          gatewayRequests: calls,
          requests: 32,
          latencyMs: Math.max(...responses.map(({ elapsedMs }) => elapsedMs)),
          detail: `two processes collapsed 32 cold readers to ${calls} loader call(s)`,
        };
      }),
    );

    scenarios.push(
      await scenario("distributed revalidation", upstream, async () => {
        const base = command("redis-stale", { ttl: 1, swr: 10 });
        await first.request({ ...base, operation: "get", value: 1 });
        await second.request({ ...base, operation: "get", value: 1 });
        await wait(1_100);
        const before = upstream.total("redis-stale");
        const responses = await Promise.all([
          first.request({ ...base, operation: "burst", count: 16, value: 2 }),
          second.request({ ...base, operation: "burst", count: 16, value: 2 }),
        ]);
        await Promise.all(
          workers.map((worker) => worker.request({ operation: "drain", timeoutMs: 3_000 })),
        );
        const calls = upstream.total("redis-stale") - before;
        return {
          passed: calls === 1,
          gatewayRequests: calls,
          requests: 32,
          latencyMs: Math.max(...responses.map(({ elapsedMs }) => elapsedMs)),
          detail: `two-process stale burst triggered ${calls} distributed refresh`,
        };
      }),
    );

    scenarios.push(
      await scenario("L2 promotion", upstream, async () => {
        const base = command("redis-promotion", { ttl: 60 });
        const before = upstream.total("redis-promotion");
        await first.request({ ...base, operation: "get", value: 7 });
        const promoted = await second.request({ ...base, operation: "get", value: 8 });
        const calls = upstream.total("redis-promotion") - before;
        return {
          passed: calls === 1 && promoted.result.value === 7,
          gatewayRequests: calls,
          requests: 2,
          latencyMs: promoted.elapsedMs,
          detail: `second process read value ${promoted.result.value} with ${calls} loader call(s)`,
        };
      }),
    );

    scenarios.push(
      await scenario("pub/sub invalidation", upstream, async () => {
        const base = command("redis-invalidation", { ttl: 60, tags: ["acceptance:menu"] });
        const before = upstream.total("redis-invalidation");
        await first.request({ ...base, operation: "get", value: 1 });
        await second.request({ ...base, operation: "get", value: 1 });
        await first.request({ operation: "invalidate-tags", tags: ["acceptance:menu"] });
        await wait(150);
        const reloaded = await second.request({ ...base, operation: "get", value: 2 });
        const calls = upstream.total("redis-invalidation") - before;
        return {
          passed: calls === 2 && reloaded.result.value === 2,
          gatewayRequests: calls,
          requests: 3,
          latencyMs: reloaded.elapsedMs,
          detail: `remote L1 observed tag invalidation; loader calls=${calls}`,
        };
      }),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.close()));
  }

  scenarios.push(await degradationScenario(false));
  scenarios.push(await degradationScenario(true));
  return topologyReport("memory+redis", scenarios);
}

async function degradationScenario(required) {
  const title = required ? "required Redis degradation" : "optional Redis degradation";
  const started = performance.now();
  try {
    const worker = await startWorker("redis", {
      redisUrl: "redis://127.0.0.1:1",
      required,
      startupTimeoutMs: 8_000,
      releaseId: `cache-degradation-${Date.now()}-${required}`,
    });
    const health = await worker.request({ operation: "health" });
    await worker.close();
    return {
      title,
      passed: !required && health.healthy,
      requests: 1,
      gatewayRequests: 0,
      protectionRatio: 0,
      latencyMs: performance.now() - started,
      detail: required ? "required Redis unexpectedly started" : "optional Redis degraded to L1",
    };
  } catch (error) {
    return {
      title,
      passed: required,
      requests: 1,
      gatewayRequests: 0,
      protectionRatio: 0,
      latencyMs: performance.now() - started,
      detail: required ? "startup failed closed" : `optional Redis failed: ${errorMessage(error)}`,
    };
  }
}

async function scenario(title, upstream, run) {
  const started = performance.now();
  try {
    const result = await run();
    return {
      title,
      ...result,
      latencyMs: result.latencyMs ?? performance.now() - started,
      protectionRatio: result.requests / Math.max(1, result.gatewayRequests),
    };
  } catch (error) {
    return {
      title,
      passed: false,
      requests: 0,
      gatewayRequests: 0,
      protectionRatio: 0,
      latencyMs: performance.now() - started,
      detail: errorMessage(error),
    };
  }
}

function topologyReport(topology, scenarios) {
  return {
    topology,
    passed: scenarios.every(({ passed }) => passed),
    scenarios,
    latency: summarizeLatency(scenarios.map(({ latencyMs }) => latencyMs)),
  };
}

function command(scenarioName, policy, overrides = {}) {
  return {
    operation: "get",
    scenario: scenarioName,
    upstreamUrl: currentUpstreamUrl,
    parts: ["main"],
    resource: { namespace: scenarioName, version: 1, ...policy },
    ...overrides,
  };
}

let currentUpstreamUrl = "";

async function startUpstream() {
  const counts = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/load") {
      response.writeHead(404).end();
      return;
    }
    const scenarioName = url.searchParams.get("scenario") ?? "unknown";
    counts.set(scenarioName, (counts.get(scenarioName) ?? 0) + 1);
    const mode = url.searchParams.get("mode");
    if (mode === "not-found") {
      response.writeHead(404).end();
      return;
    }
    if (mode === "no-content") {
      response.writeHead(204).end();
      return;
    }
    if (mode === "error") {
      response.writeHead(503).end();
      return;
    }
    const bytes = Math.max(0, Number(url.searchParams.get("bytes") ?? 0));
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        value: Number(url.searchParams.get("value") ?? 1),
        payload: "x".repeat(bytes),
      }),
    );
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("acceptance upstream did not bind");
  currentUpstreamUrl = `http://127.0.0.1:${address.port}`;
  return {
    total: (scenarioName) => counts.get(scenarioName) ?? 0,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

async function startWorker(topology, options) {
  const environment = {
    ...process.env,
    CACHE_BACKEND: topology,
    CACHE_REQUIRED: String(options.required),
    RELEASE_ID: options.releaseId ?? `cache-acceptance-${process.pid}`,
    CACHE_MAX_ENTRIES: "100",
    CACHE_L1_MAX_BYTES: "22000",
    CACHE_L1_PAGE_MAX_BYTES: "22000",
    CACHE_L1_PAGE_RESERVE_BYTES: "0",
    CACHE_L1_DATA_MAX_BYTES: "18000",
    CACHE_L1_DATA_RESERVE_BYTES: "0",
    CACHE_L1_FRAGMENT_MAX_BYTES: "22000",
    CACHE_L1_FRAGMENT_RESERVE_BYTES: "0",
    CACHE_L1_NEGATIVE_MAX_BYTES: "8000",
    CACHE_L1_NEGATIVE_RESERVE_BYTES: "0",
    LOG_LEVEL: "error",
    ...(topology === "redis" ? { REDIS_URL: options.redisUrl } : { REDIS_URL: "" }),
  };
  const child = spawn(process.execPath, ["--import", "tsx/esm", WORKER], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  let startupResolve;
  let startupReject;
  const startup = new Promise((resolvePromise, reject) => {
    startupResolve = resolvePromise;
    startupReject = reject;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.type === "ready") startupResolve(message);
      else if (message.type === "fatal") startupReject(new Error(message.error));
      else {
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        message.ok ? waiter.resolve(message.result) : waiter.reject(new Error(message.error));
      }
    }
  });
  child.once("exit", (code) => {
    const error = new Error(`cache worker exited ${code}: ${stderr.trim()}`);
    startupReject(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  try {
    await withTimeout(startup, options.startupTimeoutMs ?? 10_000, "cache worker startup");
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return {
    request(commandValue) {
      const id = nextId++;
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
        child.stdin.write(`${JSON.stringify({ ...commandValue, id })}\n`);
      });
    },
    async close() {
      if (child.exitCode !== null) return;
      try {
        const id = nextId++;
        await new Promise((resolvePromise, reject) => {
          pending.set(id, { resolve: resolvePromise, reject });
          child.stdin.write(`${JSON.stringify({ id, operation: "close" })}\n`);
        });
      } finally {
        child.stdin.end();
      }
    },
  };
}

function summarizeLatency(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function nanosecondsToMs(value) {
  return Number.isFinite(value) ? value / 1_000_000 : 0;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv) {
  const parsed = { topology: "memory", outputDirectory: "load-test/reports" };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--topology") parsed.topology = argv[++index];
    else if (value === "--output-dir") parsed.outputDirectory = argv[++index];
    else if (value === "--") continue;
    else throw new Error(`unknown option: ${value}`);
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { report, path } = await runCacheAcceptance(parseArgs(process.argv.slice(2)));
    for (const topology of report.topologies) {
      console.log(`\n${topology.topology}`);
      for (const item of topology.scenarios) {
        console.log(`  ${item.passed ? "✓" : "✗"} ${item.title}: ${item.detail}`);
      }
    }
    console.log(`\nCache acceptance ${report.passed ? "PASSED" : "FAILED"} → ${path}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`cache acceptance failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
