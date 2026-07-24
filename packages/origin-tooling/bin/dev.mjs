import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { loadEnv } from "./load-env.mjs";

loadEnv("development");

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const viteUrl = new URL(process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174");
const appUrl = new URL(process.env.SITE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3005"}`);
const gatewayUrl = new URL(process.env.GATEWAY_URL ?? "http://127.0.0.1:4002");
const children = new Set();
let stopping = false;

if (viteUrl.protocol !== "http:") {
  throw new Error("origin-dev currently requires an http VITE_DEV_SERVER_URL");
}

function start(label, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  children.add(child);

  child.once("error", (error) => {
    console.error(`[dev:${label}] could not start:`, error);
    shutdown("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(`[dev:${label}] exited${signal ? ` with ${signal}` : ` (${code ?? 1})`}`);
    shutdown("SIGTERM", code && code > 0 ? code : 1);
  });
}

function shutdown(signal, exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }

  const force = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 5_000);
  force.unref();
}

process.once("SIGINT", () => shutdown("SIGINT", 0));
process.once("SIGTERM", () => shutdown("SIGTERM", 0));

console.log(`[dev] env: ${process.env.APP_ENV} · cache: ${process.env.CACHE_BACKEND ?? "memory"}`);
console.log(`[dev] Hono: ${appUrl.origin}`);
console.log(`[dev] Vite: ${viteUrl.origin}`);
console.log(`[dev] Gateway: ${gatewayUrl.origin} (start it yourself; see GATEWAY_URL)`);

start(
  "vite",
  [
    resolve(root, "node_modules/vite/bin/vite.js"),
    "--host",
    viteUrl.hostname,
    "--port",
    viteUrl.port || "5174",
    "--strictPort",
  ],
  { SITE_URL: appUrl.origin },
);
// The gateway is not spawned here. Point GATEWAY_URL at a running upstream — a
// shared dev/staging gateway, or a local mock started separately.
start("server", [resolve(root, "node_modules/tsx/dist/cli.mjs"), "watch", "server/index.ts"], {
  NODE_ENV: "development",
  APP_ENV: "development",
  GATEWAY_URL: gatewayUrl.origin,
  SITE_URL: appUrl.origin,
  VITE_DEV_SERVER_URL: viteUrl.origin,
});
