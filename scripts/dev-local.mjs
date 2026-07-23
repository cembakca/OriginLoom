import { spawn } from "node:child_process";

import { ensureLocalRedis } from "./local-redis.mjs";
import { loadEnv, loadEnvOverlay } from "./load-env.mjs";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(" ")} stopped with ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

async function prepareRedis() {
  // app/mock-gw only exist as Docker services in the base compose file; stopping them here is
  // harmless if they were never started and avoids port clashes with the host-run `npm run dev`.
  await run("docker", ["compose", "stop", "app", "mock-gw"]);
  await ensureLocalRedis();
}

function startDevelopment() {
  loadEnv("development");
  loadEnvOverlay(".env.development.redis");

  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath ? [npmExecPath, "run", "dev"] : ["run", "dev"];
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forward("SIGINT"));
  process.once("SIGTERM", () => forward("SIGTERM"));

  child.once("error", (error) => {
    console.error("Development processes could not be started:", error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

try {
  await prepareRedis();
  startDevelopment();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
