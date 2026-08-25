#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { loadEnv } from "./load-env.mjs";

loadEnv("production");
const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const gatewayIndex = process.argv.indexOf("--gateway");
const gatewayEntry = gatewayIndex === -1 ? undefined : process.argv[gatewayIndex + 1];
const appPort = Number(process.env.QUALITY_PORT ?? 3010);
const gatewayPort = Number(process.env.QUALITY_GATEWAY_PORT ?? appPort + 1);
const metricsPort = Number(process.env.QUALITY_METRICS_PORT ?? appPort + 2);
const children = new Set();
let stopping = false;
if (!gatewayEntry) fail("Usage: origin-quality-server --gateway <entry>");
if (!existsSync(resolve(root, "dist/server/index.js")))
  fail("dist/server/index.js not found; run pnpm build first.");
await Promise.all([
  assertPortAvailable(appPort, "app"),
  assertPortAvailable(gatewayPort, "gateway"),
  assertPortAvailable(metricsPort, "metrics"),
]);

const gateway = start([resolve(root, gatewayEntry)], {
  MOCK_GATEWAY_PORT: String(gatewayPort),
  MOCK_GW_QUIET: "1",
});
const server = start(["--enable-source-maps", resolve(root, "dist/server/index.js")], {
  NODE_ENV: "production",
  APP_ENV: "production",
  PORT: String(appPort),
  METRICS_PORT: String(metricsPort),
  SITE_URL: `http://127.0.0.1:${appPort}`,
  GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
  ALLOW_INSECURE_GATEWAY: "true",
  RELEASE_ID: "quality-gate",
  APP_ID: "quality-gate",
  AUTH_REFRESH_COORDINATION_SECRET: "quality-gate-auth-refresh-coordination-secret",
  CACHE_BACKEND: "memory",
  CACHE_REQUIRED: "false",
});

process.once("SIGINT", () => shutdown("SIGINT", 0));
process.once("SIGTERM", () => shutdown("SIGTERM", 0));

try {
  await waitUntilReady(`http://127.0.0.1:${appPort}/healthz`);
  console.log(`[quality] ready http://127.0.0.1:${appPort}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function start(args, extraEnv) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  children.add(child);
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) shutdown("SIGTERM", code && code > 0 ? code : 1);
  });
  child.once("error", (error) => fail(error.message));
  return child;
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (gateway.exitCode !== null || server.exitCode !== null)
      throw new Error("quality server child exited during startup");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The server is still starting; retry until the bounded deadline.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("quality server did not become healthy in 30s");
}

function shutdown(signal, code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill(signal);
  if (children.size === 0) process.exit(code);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  shutdown("SIGTERM", 1);
}

function assertPortAvailable(port, label) {
  return new Promise((resolveAvailable, reject) => {
    const probe = createServer();
    probe.once("error", (error) =>
      reject(new Error(`${label} port ${port} is unavailable: ${error.code ?? error.message}`)),
    );
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => (error ? reject(error) : resolveAvailable()));
    });
  });
}
