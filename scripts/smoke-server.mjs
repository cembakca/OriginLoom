import { spawn } from "node:child_process";

import { loadEnv } from "./load-env.mjs";

loadEnv("production");

const port = 31_305;
const gatewayPort = 31_402;
const metricsPort = 31_905;
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
    METRICS_PORT: String(metricsPort),
    CACHE_REQUIRED: "false",
    REDIS_URL: "redis://127.0.0.1:1",
    GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    ALLOW_INSECURE_GATEWAY: "true",
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
        const [pipelineResponse, publicMetrics, clusterMetrics, robots, head, method] =
          await Promise.all([
            fetch(`http://127.0.0.1:${port}/kaldirildi`),
            fetch(`http://127.0.0.1:${port}/metrics`),
            fetch(`http://127.0.0.1:${metricsPort}/metrics`),
            fetch(`http://127.0.0.1:${port}/robots.txt`),
            fetch(`http://127.0.0.1:${port}/?utm_source=head-smoke`, { method: "HEAD" }),
            fetch(`http://127.0.0.1:${port}/`, { method: "POST" }),
          ]);
        if (
          pipelineResponse.status === 410 &&
          publicMetrics.status === 404 &&
          clusterMetrics.ok &&
          (await clusterMetrics.text()).includes("ssr_http_requests_total") &&
          robots.ok &&
          head.ok &&
          head.headers.get("set-cookie")?.includes("utm_source=head-smoke") &&
          head.headers.get("cache-control") === "private, no-store" &&
          method.status === 405 &&
          method.headers.get("allow") === "GET, HEAD"
        ) {
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
