#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import autocannon from "autocannon";

import { CAPACITY_ROUTES } from "./capacity-scenarios.mjs";

const options = parseArgs(process.argv.slice(2));
const route = CAPACITY_ROUTES.find(({ id }) => id === options.route);
if (!route) throw new Error(`unknown route: ${options.route}`);
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const directory = resolve(options.outputDirectory, `${stamp}-${route.id}-c${options.connections}`);
await mkdir(directory, { recursive: true });
if (!options.noBuild) runCommand("pnpm", ["run", "build"]);

const [appPort, opsPort, gatewayPort] = await Promise.all([freePort(), freePort(), freePort()]);
const baseUrl = `http://127.0.0.1:${appPort}`;
const mockGatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const cpuName = `${route.id}-c${options.connections}.cpuprofile`;
const heapName = `${route.id}-c${options.connections}.heapprofile`;
const profileTarget = fileURLToPath(new URL("./profile-target.mjs", import.meta.url));
const children = [];

try {
  children.push(
    spawn(process.execPath, ["mock-gateway/server.mjs"], {
      env: { ...process.env, MOCK_GATEWAY_PORT: String(gatewayPort), MOCK_GW_QUIET: "1" },
      stdio: "ignore",
    }),
  );
  children.push(
    spawn(process.execPath, [profileTarget, directory, cpuName, heapName], {
      env: appEnvironment({ baseUrl, mockGatewayUrl, appPort, opsPort }),
      stdio: "ignore",
    }),
  );
  await Promise.all([
    waitForUrl(`${baseUrl}/healthz`, 60_000),
    waitForUrl(`${mockGatewayUrl}/__originloom__/stats`, 30_000),
  ]);
  console.log(`Profiling ${route.title} c=${options.connections} (${options.durationSeconds}s)`);
  if (options.warmupSeconds) {
    await cannon(
      new URL(route.path, baseUrl).toString(),
      route,
      options.connections,
      options.warmupSeconds,
    );
  }
  children[1].kill("SIGUSR2");
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const result = await cannon(
    new URL(route.path, baseUrl).toString(),
    route,
    options.connections,
    options.durationSeconds,
  );
  children[1].kill("SIGUSR1");
  await waitForExit(children[1], 10_000);
  await stop([children[0]]);
  const cpu = await summarizeCpu(resolve(directory, cpuName));
  const heap = await summarizeHeap(resolve(directory, heapName));
  const metadata = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    route,
    connections: options.connections,
    durationSeconds: options.durationSeconds,
    warmupSeconds: options.warmupSeconds,
    requests: result.requests.total,
    requestsPerSecond: result.requests.average ?? 0,
    latencyP99Ms: result.latency.p99 ?? 0,
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    cpuProfile: cpuName,
    heapProfile: heapName,
    cpuTop: cpu,
    heapTop: heap,
  };
  await Promise.all([
    writeFile(resolve(directory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
    writeFile(resolve(directory, "summary.md"), renderSummary(metadata)),
  ]);
  console.log(`✓ profile report: ${resolve(directory, "summary.md")}`);
} finally {
  await stop(children);
}

async function summarizeCpu(path) {
  const profile = JSON.parse(await readFile(path, "utf8"));
  const hits = new Map();
  for (const id of profile.samples ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
  const rows = (profile.nodes ?? [])
    .map((node) => ({
      function: node.callFrame?.functionName || "(anonymous)",
      url: node.callFrame?.url || "",
      line: (node.callFrame?.lineNumber ?? -1) + 1,
      samples: hits.get(node.id) ?? node.hitCount ?? 0,
    }))
    .filter(({ samples }) => samples > 0);
  return combineRows(rows, "samples")
    .sort((left, right) => right.samples - left.samples)
    .slice(0, 20);
}

async function summarizeHeap(path) {
  const profile = JSON.parse(await readFile(path, "utf8"));
  const rows = [];
  const visit = (node) => {
    if (!node) return;
    if (node.selfSize > 0) {
      rows.push({
        function: node.callFrame?.functionName || "(anonymous)",
        url: node.callFrame?.url || "",
        line: (node.callFrame?.lineNumber ?? -1) + 1,
        selfBytes: node.selfSize,
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile.head);
  return combineRows(rows, "selfBytes")
    .sort((left, right) => right.selfBytes - left.selfBytes)
    .slice(0, 20);
}

function combineRows(rows, valueKey) {
  const combined = new Map();
  for (const row of rows) {
    const key = `${row.function}\0${row.url}\0${row.line}`;
    const current = combined.get(key) ?? { ...row, [valueKey]: 0 };
    current[valueKey] += row[valueKey];
    combined.set(key, current);
  }
  return [...combined.values()];
}

function renderSummary(metadata) {
  const lines = [
    "# OriginLoom profiling raporu",
    "",
    "> Profiler overhead ekler. Buradaki RPS/latency kapasite baseline'ına alınmaz; dosyalar yalnız",
    "> darboğazın kaynağını teşhis etmek içindir.",
    "",
    `- Route: **${metadata.route.title}** (${metadata.route.path})`,
    `- Bağlantı: **${metadata.connections}**`,
    `- Ölçüm: **${metadata.durationSeconds}s**`,
    `- İstek: **${metadata.requests}**`,
    `- RPS: **${Number(metadata.requestsPerSecond).toFixed(1)}**`,
    `- p99: **${Number(metadata.latencyP99Ms).toFixed(1)} ms**`,
    "",
    "## CPU — en çok sample alan frame'ler",
    "",
    "| Fonksiyon | Dosya | Sample |",
    "| --- | --- | ---: |",
    ...metadata.cpuTop.map(
      (row) => `| ${cell(row.function)} | ${cell(location(row))} | ${row.samples} |`,
    ),
    "",
    "## Heap allocation — en büyük self size",
    "",
    "| Fonksiyon | Dosya | Self |",
    "| --- | --- | ---: |",
    ...metadata.heapTop.map(
      (row) =>
        `| ${cell(row.function)} | ${cell(location(row))} | ${(row.selfBytes / 1024).toFixed(1)} KiB |`,
    ),
    "",
    `Ham CPU profili: \`${metadata.cpuProfile}\``,
    `Ham heap profili: \`${metadata.heapProfile}\``,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function appEnvironment({ baseUrl, mockGatewayUrl, appPort, opsPort }) {
  return {
    ...process.env,
    NODE_ENV: "production",
    APP_ENV: "production",
    PORT: String(appPort),
    METRICS_PORT: String(opsPort),
    SITE_URL: baseUrl,
    GATEWAY_URL: mockGatewayUrl,
    ALLOW_INSECURE_GATEWAY: "true",
    RELEASE_ID: `profile-${Date.now()}`,
    AUTH_REFRESH_COORDINATION_SECRET: "profile-auth-refresh-secret-000000000000000000",
    CACHE_PURGE_SECRET: "profile-cache-purge-secret",
    CACHE_BACKEND: "memory",
    CACHE_REQUIRED: "false",
    SUPPORT_EMAIL: "profile@example.invalid",
    ANALYTICS_VENDOR_URL: `${mockGatewayUrl}/vendor/consent.js`,
  };
}

function cannon(url, route, connections, duration) {
  return new Promise((resolveRun, rejectRun) => {
    autocannon(
      { url, connections, duration, headers: { accept: route.accept ?? "text/html" } },
      (error, result) => (error ? rejectRun(error) : resolveRun(result)),
    );
  });
}

async function stop(processes) {
  for (const child of processes)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.all(
    processes.map(
      (child) =>
        new Promise((resolveExit) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
          child.once("exit", resolveExit);
          setTimeout(resolveExit, 10_000).unref();
        }),
    ),
  );
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
    const timer = setTimeout(
      () => rejectExit(new Error("profile target did not flush in time")),
      timeoutMs,
    );
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return rejectPort(new Error("no free port"));
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
      // Startup polling is expected to fail until both listeners bind.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${url} did not become ready`);
}

function parseArgs(argv) {
  const parsed = {
    route: "data-cache",
    connections: 100,
    durationSeconds: 30,
    warmupSeconds: 10,
    outputDirectory: "load-test/reports/profiles",
    noBuild: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--route") parsed.route = argv[++index];
    else if (arg === "--connections") parsed.connections = positive(argv[++index], arg);
    else if (arg === "--duration") parsed.durationSeconds = positive(argv[++index], arg);
    else if (arg === "--warmup") parsed.warmupSeconds = nonNegative(argv[++index], arg);
    else if (arg === "--output-dir") parsed.outputDirectory = argv[++index];
    else if (arg === "--no-build") parsed.noBuild = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

function positive(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${flag} must be positive integer`);
  return number;
}

function nonNegative(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${flag} cannot be negative`);
  return number;
}

function location(row) {
  return row.url ? `${row.url}:${row.line}` : "(native/internal)";
}

function cell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
