import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

import { ensureLocalRedis, removeLocalRedis } from "./local-redis.mjs";
import { loadEnv } from "./load-env.mjs";

const [appEnv, ...flags] = process.argv.slice(2);
const useRedis = flags.includes("--redis");

if (appEnv !== "staging" && appEnv !== "production") {
  console.error("Usage: node scripts/run-local.mjs <staging|production> [--redis]");
  process.exit(1);
}

if (!existsSync("dist/server/index.js")) {
  console.error("dist/server/index.js not found — run `npm run build` first.");
  process.exit(1);
}

loadEnv(appEnv);

// Local dry run only: always talk to the host-run mock gateway, never the real
// staging/production infrastructure `.env.${appEnv}` points at. Real deployments invoke
// `npm run start`/`start:staging`/`start:memory` directly, without this override layer.
const gatewayPort = 4002;
const appPort = Number(process.env.PORT ?? 3005);
process.env.GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
process.env.SITE_URL = `http://127.0.0.1:${appPort}`;

if (useRedis) {
  await ensureLocalRedis();
  process.env.CACHE_BACKEND = "redis";
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
  process.env.CACHE_REQUIRED ??= "false";
} else {
  process.env.CACHE_BACKEND = "memory";
  delete process.env.REDIS_URL;
  process.env.CACHE_REQUIRED = "false";
}

console.log(
  `[local:${appEnv}] cache=${process.env.CACHE_BACKEND} gateway=${process.env.GATEWAY_URL} app=${process.env.SITE_URL}`,
);

const children = new Set();
let stopping = false;

function start(label, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  children.add(child);

  child.once("error", (error) => {
    console.error(`[local:${label}] could not start:`, error);
    shutdown("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(`[local:${label}] exited${signal ? ` with ${signal}` : ` (${code ?? 1})`}`);
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

  const finish = async () => {
    if (useRedis) {
      try {
        await removeLocalRedis();
      } catch (error) {
        console.error(
          "Could not remove Redis container:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    process.exit(process.exitCode ?? exitCode);
  };

  if (children.size === 0) {
    void finish();
    return;
  }

  let pending = children.size;
  for (const child of children) {
    child.once("exit", () => {
      pending--;
      if (pending === 0) void finish();
    });
  }
}

process.once("SIGINT", () => shutdown("SIGINT", 0));
process.once("SIGTERM", () => shutdown("SIGTERM", 0));

start("gateway", ["../../tools/mock-gw/server.js"], { PORT: String(gatewayPort) });
start("server", ["--enable-source-maps", "dist/server/index.js"]);
