import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { loadEnv } from "./load-env.mjs";

loadEnv("production");

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const port = 31_305;
const gatewayPort = 31_402;
const metricsPort = 31_905;

// The smoke gate stays hermetic: pass `--gateway <path>` to spawn a local gateway
// (e.g. a test fixture). Without it, GATEWAY_URL must point at a running upstream.
const gatewayFlagIndex = process.argv.indexOf("--gateway");
const gatewayEntry = gatewayFlagIndex !== -1 ? process.argv[gatewayFlagIndex + 1] : undefined;

// Everything below the platform invariants is app-specific: a redirect rule that
// answers 410, an SEO route serving robots.txt. Apps opt in; the defaults hold
// for any OriginLoom app, including a freshly generated one.
const expectOk = collectFlag("--expect-ok");
const expectGone = collectFlag("--expect-gone");

function collectFlag(flag) {
  const values = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) values.push(process.argv[++i]);
  }
  return values;
}
const gateway = gatewayEntry
  ? spawn(process.execPath, [resolve(root, gatewayEntry)], {
      stdio: "inherit",
      env: {
        ...process.env,
        MOCK_GATEWAY_PORT: String(gatewayPort),
        MOCK_GW_QUIET: "1",
      },
    })
  : null;
const gatewayUrl = gatewayEntry
  ? `http://127.0.0.1:${gatewayPort}`
  : (process.env.GATEWAY_URL ?? `http://127.0.0.1:${gatewayPort}`);

const child = spawn(process.execPath, ["dist/server/index.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    METRICS_PORT: String(metricsPort),
    CACHE_REQUIRED: "false",
    REDIS_URL: "redis://127.0.0.1:1",
    GATEWAY_URL: gatewayUrl,
    ALLOW_INSECURE_GATEWAY: "true",
    SITE_URL: `http://127.0.0.1:${port}`,
    CACHE_PURGE_SECRET: "smoke-test-secret",
    RELEASE_ID: "smoke-test",
    // Production config demands these; a throwaway server gets throwaway values,
    // so `pnpm smoke` works in a freshly generated app with no secret manager.
    AUTH_REFRESH_COORDINATION_SECRET:
      process.env.AUTH_REFRESH_COORDINATION_SECRET ?? "smoke-test-auth-refresh-coordination-secret",
  },
});

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 10_000;
let failures = ["server never became healthy"];

try {
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${base}/healthz`);
      if (health.ok && (await health.text()) === "ok") {
        failures = await runChecks();
        if (failures.length === 0) break;
      }
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} finally {
  child.kill("SIGTERM");
  gateway?.kill("SIGTERM");
}

if (failures.length > 0) {
  throw new Error(`Server smoke test failed:\n  - ${failures.join("\n  - ")}`);
}

/** @returns {Promise<string[]>} one message per failed expectation */
async function runChecks() {
  const [home, publicMetrics, clusterMetrics, head, method] = await Promise.all([
    fetch(`${base}/`),
    fetch(`${base}/metrics`),
    fetch(`http://127.0.0.1:${metricsPort}/metrics`),
    fetch(`${base}/?utm_source=head-smoke`, { method: "HEAD" }),
    fetch(`${base}/`, { method: "POST" }),
  ]);
  const clusterBody = await clusterMetrics.text();

  const failed = [];
  const expect = (condition, message) => {
    if (!condition) failed.push(message);
  };

  expect(home.ok, `GET / responded ${home.status}`);
  expect(
    publicMetrics.status === 404,
    `/metrics is public (${publicMetrics.status}), it must not be`,
  );
  expect(clusterMetrics.ok, `metrics port responded ${clusterMetrics.status}`);
  expect(
    clusterBody.includes("ssr_http_requests_total"),
    "metrics output has no ssr_http_requests_total",
  );
  expect(head.ok, `HEAD / responded ${head.status}`);
  expect(
    head.headers.get("set-cookie")?.includes("utm_source=head-smoke"),
    "session pipeline did not record the utm_source on a HEAD request",
  );
  expect(
    head.headers.get("cache-control") === "private, no-store",
    `a response that sets cookies returned cache-control: ${head.headers.get("cache-control")}`,
  );
  expect(method.status === 405, `POST / responded ${method.status}, expected 405`);
  expect(
    method.headers.get("allow") === "GET, HEAD",
    `405 allow header: ${method.headers.get("allow")}`,
  );

  for (const path of expectOk) {
    const response = await fetch(`${base}${path}`);
    expect(response.ok, `${path} responded ${response.status}, expected 2xx`);
  }
  for (const path of expectGone) {
    const response = await fetch(`${base}${path}`);
    expect(response.status === 410, `${path} responded ${response.status}, expected 410`);
  }

  return failed;
}
