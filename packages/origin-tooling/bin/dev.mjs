import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnv } from "./load-env.mjs";

loadEnv("development");

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const viteUrl = new URL(process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174");
const appUrl = new URL(process.env.SITE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3005"}`);
const gatewayUrl = new URL(process.env.GATEWAY_URL ?? "http://127.0.0.1:4002");
// `--gateway <path>` spawns a local upstream (a mock) alongside the app, the way
// origin-smoke does. Without it, GATEWAY_URL must point at something running.
const gatewayFlagIndex = process.argv.indexOf("--gateway");
const gatewayEntry = gatewayFlagIndex !== -1 ? process.argv[gatewayFlagIndex + 1] : undefined;
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

/**
 * Generated assets, on the same opt-in inputs `origin-build` uses. Dev needs them
 * for the same reason the build does: the document references the favicon and OG
 * image by path, and without them the browser reports a 404 on every page.
 */
function generate(label, script) {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [new URL(script, import.meta.url).pathname], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", fail);
    child.once("exit", (code) =>
      code === 0 ? settle() : fail(new Error(`${label} exited with code ${code}`)),
    );
  });
}

if (existsSync(resolve(root, "src/assets/svg"))) await generate("icons", "./generate-icons.mjs");
if (existsSync(resolve(root, "server/media.config.json")))
  await generate("media", "./build-media.mjs");

console.log(`[dev] env: ${process.env.APP_ENV} · cache: ${process.env.CACHE_BACKEND ?? "memory"}`);
console.log(`[dev] Hono: ${appUrl.origin}`);
console.log(`[dev] Vite: ${viteUrl.origin}`);
console.log(
  gatewayEntry
    ? `[dev] Gateway: ${gatewayUrl.origin} (${gatewayEntry})`
    : `[dev] Gateway: ${gatewayUrl.origin} (start it yourself; see GATEWAY_URL)`,
);

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
if (gatewayEntry) {
  start("gateway", [resolve(root, gatewayEntry)], { PORT: gatewayUrl.port || "4002" });
}
start("server", [resolve(root, "node_modules/tsx/dist/cli.mjs"), "watch", "server/index.ts"], {
  NODE_ENV: "development",
  APP_ENV: "development",
  GATEWAY_URL: gatewayUrl.origin,
  SITE_URL: appUrl.origin,
  VITE_DEV_SERVER_URL: viteUrl.origin,
});
