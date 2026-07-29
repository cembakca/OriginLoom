#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { cpus, loadavg, totalmem } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";

import autocannon from "autocannon";

import {
  createResourceSummary,
  fetchMetrics,
  metricDelta,
  observeResources,
  sumMetric,
} from "./capacity-metrics.mjs";
import { aggregateRuns, analyzeCapacity, writeCapacityReports } from "./capacity-report.mjs";
import {
  CAPACITY_PROFILES,
  CAPACITY_ROUTES,
  estimateDurationSeconds,
} from "./capacity-scenarios.mjs";

const options = parseArgs(process.argv.slice(2));
const profile = resolveProfile(options);
const routes = resolveRoutes(options.only);
const startedAt = new Date().toISOString();
const started = performance.now();
const outputDirectory = resolve(options.outputDirectory);
const children = [];
let stopping = false;

const estimate = estimateDurationSeconds(routes.length, profile);
console.log(`\nOriginLoom kapasite testi — ${options.profile} profil`);
console.log(`Route: ${routes.length}, bağlantılar: ${profile.connections.join(", ")}`);
console.log(`Tekrar: ${profile.repeats}, kademe: ${profile.durationSeconds}s`);
console.log(`Tahmini süre: ${formatDuration(estimate)}\n`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stopChildren().finally(() => process.exit(130));
  });
}

let environment;
try {
  environment = options.external ? externalEnvironment(options) : await startLocalEnvironment();
  await verifyEnvironment(environment);

  const runs = [];
  console.log("Route warm-up başlıyor...");
  for (const [routeIndex, route] of routes.entries()) {
    console.log(`  [${routeIndex + 1}/${routes.length}] ${route.title}`);
    await verifyRoute(environment.baseUrl, route);
    if (profile.warmupSeconds > 0) {
      await runCannon({
        url: new URL(route.path, environment.baseUrl).toString(),
        route,
        connections: profile.connections[0],
        duration: profile.warmupSeconds,
      });
    }
  }

  const matrixTotal = routes.length * profile.connections.length * profile.repeats;
  let matrixIndex = 0;
  for (const [stageIndex, connections] of profile.connections.entries()) {
    for (let repeat = 1; repeat <= profile.repeats; repeat++) {
      const order = rotateRoutes(routes, stageIndex * profile.repeats + repeat - 1);
      for (const route of order) {
        matrixIndex++;
        console.log(
          `\n[${matrixIndex}/${matrixTotal}] c=${connections} tekrar=${repeat} ` +
            `${route.title} — ${route.path}`,
        );
        await verifyRoute(environment.baseUrl, route);
        await resetMockStats(environment.mockGatewayUrl);
        const run = await measuredRun({
          environment,
          route,
          connections,
          duration: profile.durationSeconds,
          repeat,
        });
        runs.push(run);
        console.log(
          `  c=${connections} tekrar=${repeat}/${profile.repeats} ` +
            `RPS=${run.requestsPerSecond.toFixed(1)} p99=${run.latency.p99.toFixed(1)}ms ` +
            `EL=${run.resource.eventLoopP99PeakMs.toFixed(1)}ms ` +
            `${run.valid ? "✓" : "✗"}`,
        );
        if (profile.cooldownMs) await wait(profile.cooldownMs);
      }
    }
  }

  console.log("\nCache/gateway deneyleri");
  const cacheExperiments = await runCacheExperiments(environment, profile);
  for (const experiment of cacheExperiments) {
    console.log(`  ${experiment.passed ? "✓" : "✗"} ${experiment.title}: ${experiment.detail}`);
  }

  const aggregates = aggregateRuns(runs);
  const analysis = analyzeCapacity(aggregates);
  const report = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationSeconds: (performance.now() - started) / 1_000,
    config: { profile: options.profile, ...profile, routes: routes.map(({ id }) => id) },
    environment: {
      ...environment,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      loadAverageStart: environment.loadAverageStart,
      loadAverageEnd: loadavg(),
    },
    runs,
    aggregates,
    analysis,
    cacheExperiments,
  };
  const paths = await writeCapacityReports(report, outputDirectory);
  console.log(`\nMarkdown rapor → ${paths.markdown}`);
  console.log(`JSON rapor     → ${paths.json}`);
  console.log(`Son rapor      → ${paths.latestMarkdown}\n`);

  if (
    cacheExperiments.some(({ passed }) => !passed) ||
    (options.strict && runs.some((run) => !run.valid))
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `\n✗ kapasite testi başarısız: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await stopChildren();
}

async function startLocalEnvironment() {
  if (!options.noBuild) {
    console.log("Production build hazırlanıyor...");
    runCommand("pnpm", ["run", "build"]);
  }

  const [appPort, opsPort, gatewayPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const opsUrl = `http://127.0.0.1:${opsPort}`;
  const mockGatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  const baseEnv = { ...process.env };

  children.push(
    spawn(process.execPath, ["mock-gateway/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...baseEnv,
        MOCK_GATEWAY_PORT: String(gatewayPort),
        MOCK_GATEWAY_DELAY_MS: String(options.gatewayDelayMs),
        MOCK_GW_QUIET: "1",
      },
      stdio: "ignore",
    }),
  );
  children.push(
    spawn(process.execPath, ["--enable-source-maps", "dist/server/index.js"], {
      cwd: process.cwd(),
      env: {
        ...baseEnv,
        NODE_ENV: "production",
        APP_ENV: "production",
        PORT: String(appPort),
        METRICS_PORT: String(opsPort),
        SITE_URL: baseUrl,
        GATEWAY_URL: mockGatewayUrl,
        ALLOW_INSECURE_GATEWAY: "true",
        RELEASE_ID: `capacity-${Date.now()}`,
        AUTH_REFRESH_COORDINATION_SECRET: "capacity-auth-refresh-secret-0000000000000000",
        CACHE_PURGE_SECRET: "capacity-cache-purge-secret",
        CACHE_BACKEND: "memory",
        CACHE_REQUIRED: "false",
        SUPPORT_EMAIL: "capacity@example.invalid",
        FEATURED_ITEMS_CACHE_TTL: "5",
        FEATURED_ITEMS_CACHE_SWR: "30",
        ANALYTICS_VENDOR_URL: `${mockGatewayUrl}/vendor/consent.js`,
      },
      stdio: "ignore",
    }),
  );

  for (const child of children) {
    child.once("error", (error) => {
      if (!stopping) console.error(`child process error: ${error.message}`);
    });
  }
  await Promise.all([
    waitForUrl(`${mockGatewayUrl}/__originloom__/stats`, 30_000),
    waitForUrl(`${baseUrl}/healthz`, 60_000),
    waitForUrl(`${opsUrl}/metrics`, 60_000),
  ]);
  return {
    mode: "managed-local",
    baseUrl,
    opsUrl,
    mockGatewayUrl,
    gatewayDelayMs: options.gatewayDelayMs,
    loadAverageStart: loadavg(),
  };
}

function externalEnvironment(parsed) {
  if (!parsed.baseUrl || !parsed.opsUrl || !parsed.mockGatewayUrl) {
    throw new Error("--external için --base, --ops ve --mock-gateway zorunludur");
  }
  return {
    mode: "external",
    baseUrl: parsed.baseUrl,
    opsUrl: parsed.opsUrl,
    mockGatewayUrl: parsed.mockGatewayUrl,
    gatewayDelayMs: parsed.gatewayDelayMs,
    loadAverageStart: loadavg(),
  };
}

async function measuredRun({ environment: env, route, connections, duration, repeat, amount }) {
  const before = await fetchMetrics(env.opsUrl);
  const resource = createResourceSummary();
  observeResources(resource, before);
  const generatorCpuStart = process.cpuUsage();
  const runStarted = performance.now();
  const sampler = setInterval(() => {
    void fetchMetrics(env.opsUrl)
      .then((samples) => observeResources(resource, samples))
      .catch(() => {});
  }, 500);
  sampler.unref();

  let cannon;
  try {
    cannon = await runCannon({
      url: new URL(route.path, env.baseUrl).toString(),
      route,
      connections,
      ...(amount ? { amount } : { duration }),
    });
  } finally {
    clearInterval(sampler);
  }
  const elapsedSeconds = (performance.now() - runStarted) / 1_000;
  const after = await fetchMetrics(env.opsUrl);
  observeResources(resource, after);
  const generatorCpu = process.cpuUsage(generatorCpuStart);
  const mockGateway = await readMockStats(env.mockGatewayUrl);
  const cacheStates = {};
  for (const state of ["HIT", "MISS", "STALE", "BYPASS", "REDIRECT", "PROXY", "ERROR"]) {
    const count = metricDelta(before, after, "ssr_http_requests_total", { cache: state });
    if (count) cacheStates[state] = count;
  }
  const appCpuSeconds =
    metricDelta(before, after, "process_cpu_user_seconds_total") +
    metricDelta(before, after, "process_cpu_system_seconds_total");
  const unexpectedStatuses = unexpectedStatusCounts(cannon.statusCounts, route.expectedStatuses);
  const valid =
    cannon.errors === 0 &&
    cannon.timeouts === 0 &&
    Object.values(unexpectedStatuses).every((count) => count === 0);

  return {
    route,
    connections,
    repeat,
    elapsedSeconds,
    ...cannon,
    unexpectedStatuses,
    valid,
    cacheStates,
    resource,
    metrics: {
      gatewayRequests: metricDelta(before, after, "ssr_gateway_requests_total"),
      requestTimeouts: metricDelta(before, after, "request_timeout_total"),
      renderRejections: metricDelta(before, after, "ssr_render_rejections_total"),
      cacheFills: metricDelta(before, after, "ssr_cache_fill_total"),
      appCpuPercent: (appCpuSeconds / elapsedSeconds) * 100,
      generatorCpuPercent: ((generatorCpu.user + generatorCpu.system) / 1e6 / elapsedSeconds) * 100,
      rssEndBytes: sumMetric(after, "process_resident_memory_bytes"),
    },
    mockGateway,
  };
}

async function runCacheExperiments(env, selectedProfile) {
  const experiments = [];
  const catalog = CAPACITY_ROUTES.find(({ id }) => id === "catalog");
  const dataCache = CAPACITY_ROUTES.find(({ id }) => id === "data-cache");
  const publicApi = CAPACITY_ROUTES.find(({ id }) => id === "public-items-api");
  if (!catalog || !dataCache || !publicApi) throw new Error("cache experiment routes missing");
  const connections = selectedProfile.coldBurstConnections;

  for (const [title, route] of [
    ["Catalog cold-burst single fill", catalog],
    ["Data cache cold-burst single fill", dataCache],
  ]) {
    await purgeAll(env.opsUrl);
    await resetMockStats(env.mockGatewayUrl);
    const run = await measuredRun({
      environment: env,
      route,
      connections,
      amount: connections,
      repeat: 1,
    });
    const items = pathCount(run.mockGateway, "/items");
    experiments.push({
      title,
      requests: run.requests,
      gatewayItemsRequests: items,
      gatewayTotalRequests: run.mockGateway.total,
      passed: run.valid && items <= 1,
      detail: `${connections} eşzamanlı cold request için /items çağrısı ${items}`,
    });
  }

  await purgeAll(env.opsUrl);
  await fetch(new URL(dataCache.path, env.baseUrl));
  await resetMockStats(env.mockGatewayUrl);
  await wait(5_250);
  const stale = await measuredRun({
    environment: env,
    route: dataCache,
    connections,
    amount: connections * 2,
    repeat: 1,
  });
  await wait(500);
  const staleStats = await readMockStats(env.mockGatewayUrl);
  const staleItems = pathCount(staleStats, "/items");
  experiments.push({
    title: "Data cache stale single-flight refresh",
    requests: stale.requests,
    gatewayItemsRequests: staleItems,
    gatewayTotalRequests: staleStats.total,
    passed: stale.valid && staleItems <= 1,
    detail: `${stale.requests} stale request için /items refresh sayısı ${staleItems}`,
  });

  await purgeAll(env.opsUrl);
  await fetch(new URL(dataCache.path, env.baseUrl));
  await resetMockStats(env.mockGatewayUrl);
  const protectedRun = await measuredRun({
    environment: env,
    route: dataCache,
    connections,
    duration: Math.min(5, selectedProfile.durationSeconds),
    repeat: 1,
  });
  const protectedItems = pathCount(protectedRun.mockGateway, "/items");
  const protectionRatio = protectedRun.requests / Math.max(1, protectedItems);
  experiments.push({
    title: "Warm API data-cache upstream protection",
    requests: protectedRun.requests,
    gatewayItemsRequests: protectedItems,
    gatewayTotalRequests: protectedRun.mockGateway.total,
    passed: protectedRun.valid && protectionRatio >= 100,
    detail: `${protectionRatio.toFixed(0)} HTTP request / gateway item request`,
  });

  await resetMockStats(env.mockGatewayUrl);
  const uncached = await measuredRun({
    environment: env,
    route: publicApi,
    connections,
    amount: connections * 2,
    repeat: 1,
  });
  const uncachedItems = pathCount(uncached.mockGateway, "/items");
  experiments.push({
    title: "Origin data-cache olmayan public API",
    requests: uncached.requests,
    gatewayItemsRequests: uncachedItems,
    gatewayTotalRequests: uncached.mockGateway.total,
    passed: uncached.valid && uncachedItems >= uncached.requests * 0.9,
    detail: `${uncached.requests} HTTP request için ${uncachedItems} gateway çağrısı`,
  });

  return experiments;
}

function runCannon({ url, route, connections, duration, amount }) {
  return new Promise((resolveRun, rejectRun) => {
    autocannon(
      {
        url,
        connections,
        ...(amount ? { amount } : { duration }),
        headers: {
          accept: route.accept ?? "text/html",
          "user-agent": "OriginLoom-Capacity-Test/1.0",
        },
      },
      (error, result) => {
        if (error) {
          rejectRun(error);
          return;
        }
        const statusCounts = normalizeStatusCounts(result);
        resolveRun({
          requests: result.requests.total,
          requestsPerSecond: result.requests.average ?? result.requests.mean ?? 0,
          throughputBytesPerSecond: result.throughput.average ?? result.throughput.mean ?? 0,
          latency: {
            average: result.latency.average ?? result.latency.mean ?? 0,
            p50: result.latency.p50 ?? 0,
            p95: result.latency.p95 ?? result.latency.p97_5 ?? 0,
            p99: result.latency.p99 ?? 0,
            max: result.latency.max ?? 0,
          },
          errors: result.errors ?? 0,
          timeouts: result.timeouts ?? 0,
          statusCounts,
          statusClasses: {
            "1xx": result["1xx"] ?? 0,
            "2xx": result["2xx"] ?? 0,
            "3xx": result["3xx"] ?? 0,
            "4xx": result["4xx"] ?? 0,
            "5xx": result["5xx"] ?? 0,
          },
        });
      },
    );
  });
}

async function verifyEnvironment(env) {
  await Promise.all([
    waitForUrl(`${env.baseUrl}/healthz`, 10_000),
    waitForUrl(`${env.opsUrl}/metrics`, 10_000),
    waitForUrl(`${env.mockGatewayUrl}/__originloom__/stats`, 10_000),
  ]);
}

async function verifyRoute(baseUrl, route) {
  const response = await fetch(new URL(route.path, baseUrl), {
    redirect: "manual",
    headers: { accept: route.accept ?? "text/html" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!route.expectedStatuses.includes(response.status)) {
    throw new Error(`${route.id} preflight HTTP ${response.status}`);
  }
  await response.body?.cancel();
}

async function purgeAll(opsUrl) {
  const response = await fetch(`${opsUrl}/api/internal/cache/purge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cache-purge-token": "capacity-cache-purge-secret",
    },
    body: '{"all":true}',
  });
  if (!response.ok) throw new Error(`cache purge returned HTTP ${response.status}`);
}

async function resetMockStats(mockGatewayUrl) {
  const response = await fetch(`${mockGatewayUrl}/__originloom__/stats`, { method: "DELETE" });
  if (!response.ok) throw new Error(`mock stats reset returned HTTP ${response.status}`);
}

async function readMockStats(mockGatewayUrl) {
  const response = await fetch(`${mockGatewayUrl}/__originloom__/stats`);
  if (!response.ok) throw new Error(`mock stats returned HTTP ${response.status}`);
  return response.json();
}

function pathCount(stats, path) {
  return stats.byPath?.[path] ?? 0;
}

function normalizeStatusCounts(result) {
  const counts = {};
  for (const [status, value] of Object.entries(result.statusCodeStats ?? {})) {
    counts[status] = typeof value === "number" ? value : (value?.count ?? 0);
  }
  if (Object.keys(counts).length) return counts;
  for (const group of ["1xx", "2xx", "3xx", "4xx", "5xx"]) {
    if (result[group]) counts[group] = result[group];
  }
  return counts;
}

function unexpectedStatusCounts(statusCounts, expectedStatuses) {
  const expected = new Set(expectedStatuses.map(String));
  const expectedClasses = new Set(
    expectedStatuses.map((status) => `${Math.floor(status / 100)}xx`),
  );
  return Object.fromEntries(
    Object.entries(statusCounts).filter(([status, count]) => {
      if (!count) return false;
      return status.endsWith("xx") ? !expectedClasses.has(status) : !expected.has(status);
    }),
  );
}

function resolveProfile(parsed) {
  const base = CAPACITY_PROFILES[parsed.profile];
  if (!base) throw new Error(`bilinmeyen profil: ${parsed.profile}`);
  return {
    ...base,
    ...(parsed.connections ? { connections: parsed.connections } : {}),
    ...(parsed.durationSeconds ? { durationSeconds: parsed.durationSeconds } : {}),
    ...(parsed.repeats ? { repeats: parsed.repeats } : {}),
    ...(parsed.warmupSeconds !== undefined ? { warmupSeconds: parsed.warmupSeconds } : {}),
  };
}

function resolveRoutes(only) {
  if (!only?.length) return CAPACITY_ROUTES.filter(({ matrix }) => matrix !== false);
  const selected = CAPACITY_ROUTES.filter(({ id }) => only.includes(id));
  const missing = only.filter((id) => !selected.some((route) => route.id === id));
  if (missing.length) throw new Error(`bilinmeyen route id: ${missing.join(", ")}`);
  return selected;
}

function rotateRoutes(values, offset) {
  if (!values.length) return [];
  const start = offset % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

function parseArgs(argv) {
  const parsed = {
    profile: "full",
    outputDirectory: "load-test/reports",
    gatewayDelayMs: 0,
    external: false,
    noBuild: false,
    strict: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--profile") parsed.profile = argv[++index];
    else if (arg === "--connections") parsed.connections = numberList(argv[++index], arg);
    else if (arg === "--duration") parsed.durationSeconds = positiveNumber(argv[++index], arg);
    else if (arg === "--repeats") parsed.repeats = positiveNumber(argv[++index], arg);
    else if (arg === "--warmup") parsed.warmupSeconds = nonNegativeNumber(argv[++index], arg);
    else if (arg === "--only") parsed.only = argv[++index].split(",").filter(Boolean);
    else if (arg === "--output-dir") parsed.outputDirectory = argv[++index];
    else if (arg === "--gateway-delay-ms")
      parsed.gatewayDelayMs = nonNegativeNumber(argv[++index], arg);
    else if (arg === "--external") parsed.external = true;
    else if (arg === "--no-build") parsed.noBuild = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--base") parsed.baseUrl = stripSlash(argv[++index]);
    else if (arg === "--ops") parsed.opsUrl = stripSlash(argv[++index]);
    else if (arg === "--mock-gateway") parsed.mockGatewayUrl = stripSlash(argv[++index]);
    else throw new Error(`bilinmeyen seçenek: ${arg}`);
  }
  return parsed;
}

function numberList(value, flag) {
  const values = value.split(",").map((entry) => positiveNumber(entry, flag));
  return [...new Set(values)].sort((left, right) => left - right);
}

function positiveNumber(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${flag} pozitif integer olmalı`);
  return number;
}

function nonNegativeNumber(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${flag} negatif olamaz`);
  return number;
}

function stripSlash(value) {
  return value.replace(/\/$/, "");
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} başarısız`);
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPort(new Error("boş port bulunamadı"));
        return;
      }
      server.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
    });
  });
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Startup polling is expected to fail until the listener binds.
    }
    await wait(250);
  }
  throw new Error(`${url} ${timeoutMs}ms içinde hazır olmadı`);
}

async function stopChildren() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolveExit) => {
          if (child.exitCode !== null || child.signalCode !== null) resolveExit();
          else child.once("exit", resolveExit);
          setTimeout(resolveExit, 5_000).unref();
        }),
    ),
  );
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return `${hours ? `${hours} sa ` : ""}${minutes} dk`;
}
