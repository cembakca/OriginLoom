import { spawn } from "node:child_process";

import { loadEnv } from "./load-env.mjs";

loadEnv("production");

const port = 31_305;
const gatewayPort = 31_402;
const gateway = spawn(process.execPath, ["mock-gw/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(gatewayPort),
    MOCK_GW_QUIET: "1",
  },
});
const child = spawn(process.execPath, ["dist/server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    CACHE_REQUIRED: "false",
    REDIS_URL: "redis://127.0.0.1:1",
    GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    SITE_URL: `http://127.0.0.1:${port}`,
    CACHE_PURGE_SECRET: "smoke-test-secret",
    RELEASE_ID: "smoke-test",
  },
});

const deadline = Date.now() + 10_000;
let passed = false;

try {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok && (await response.text()) === "ok") {
        const pipelineResponse = await fetch(`http://127.0.0.1:${port}/kaldirildi`);
        if (pipelineResponse.status === 410) {
          passed = true;
          break;
        }
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
} finally {
  child.kill("SIGTERM");
  gateway.kill("SIGTERM");
}

if (!passed) throw new Error("Server smoke test did not become healthy");
