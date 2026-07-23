import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

/**
 * @param {string} baseUrl
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 */
export async function waitForHealthy(baseUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";

  while (Date.now() < deadline) {
    try {
      const [health, ready] = await Promise.all([
        fetch(`${baseUrl}/healthz`),
        fetch(`${baseUrl}/readyz`),
      ]);
      if (health.ok && (await health.text()) === "ok" && ready.ok) return;
      lastError = `health=${health.status} ready=${ready.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(intervalMs);
  }

  throw new Error(`Stack did not become healthy within ${timeoutMs}ms (${lastError})`);
}

/**
 * @param {string} url
 */
export async function sampleResponseHeaders(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "origin-loom-loadtest/1.0",
      Accept: "text/html",
    },
  });
  return {
    status: response.status,
    cache: response.headers.get("x-cache"),
    requestId: response.headers.get("x-request-id"),
  };
}

/**
 * @param {number} ms
 */
export function sleep(ms) {
  return delay(ms);
}
