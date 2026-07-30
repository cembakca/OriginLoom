#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const configPath = resolve(root, "lighthouserc.json");
const reportDir = resolve(root, ".lighthouseci/reports");
const requireFromApp = createRequire(resolve(root, "package.json"));

const fail = (message) => {
  console.error(`[lighthouse] ${message}`);
  process.exitCode = 1;
};

let lighthouseEntry;
let chromium;
try {
  lighthouseEntry = requireFromApp.resolve("lighthouse");
  ({ chromium } = requireFromApp("@playwright/test"));
} catch {
  fail("Install lighthouse and @playwright/test before running this command.");
  process.exit();
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const urls = Array.isArray(config.urls) ? config.urls : [];
const runs = Number.isInteger(config.runs) && config.runs > 0 ? config.runs : 1;
const thresholds = config.thresholds ?? {};
if (urls.length === 0) {
  fail("lighthouserc.json must contain at least one URL.");
  process.exit();
}

const appUrl = new URL(urls[0]);
const qualityServerEntry = fileURLToPath(new URL("./quality-server.mjs", import.meta.url));
const [qualityGatewayPort, qualityMetricsPort] = await Promise.all([freePort(), freePort()]);
const qualityServer = spawn(
  process.execPath,
  [qualityServerEntry, "--gateway", "mock-gateway/server.mjs"],
  {
    cwd: root,
    env: {
      ...process.env,
      QUALITY_PORT: appUrl.port,
      QUALITY_GATEWAY_PORT: String(qualityGatewayPort),
      QUALITY_METRICS_PORT: String(qualityMetricsPort),
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);

const waitForServer = () =>
  new Promise((resolveReady, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("quality server readiness timed out")),
      30_000,
    );
    qualityServer.stdout.setEncoding("utf8");
    qualityServer.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (chunk.includes("[quality] ready")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    qualityServer.once("error", reject);
    qualityServer.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`quality server exited before readiness (${code ?? "unknown"})`));
    });
  });

const lowerMedian = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
const upperMedian = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const auditValue = (lhr, id) => Number(lhr.audits[id]?.numericValue ?? Number.NaN);
const scriptTransferBytes = (lhr) => {
  const rows = lhr.audits["resource-summary"]?.details?.items ?? [];
  return Number(
    rows.find((row) => String(row.resourceType).toLowerCase() === "script")?.transferSize ?? 0,
  );
};

const checks = [
  {
    key: "performanceScore",
    mode: "min",
    read: (lhr) => Number(lhr.categories.performance?.score),
  },
  {
    key: "accessibilityScore",
    mode: "min",
    read: (lhr) => Number(lhr.categories.accessibility?.score),
  },
  {
    key: "largestContentfulPaintMs",
    mode: "max",
    read: (lhr) => auditValue(lhr, "largest-contentful-paint"),
  },
  {
    key: "cumulativeLayoutShift",
    mode: "max",
    read: (lhr) => auditValue(lhr, "cumulative-layout-shift"),
  },
  {
    key: "totalBlockingTimeMs",
    mode: "max",
    read: (lhr) => auditValue(lhr, "total-blocking-time"),
  },
  { key: "scriptTransferBytes", mode: "max", read: scriptTransferBytes },
];

let chrome;
const htmlReports = [];
try {
  await waitForServer();
  await mkdir(reportDir, { recursive: true });
  const lighthouseModule = await import(pathToFileURL(lighthouseEntry));
  const requireFromLighthouse = createRequire(lighthouseEntry);
  const { launch } = requireFromLighthouse("chrome-launcher");
  chrome = await launch({
    chromePath: process.env.CHROME_PATH ?? chromium.executablePath(),
    chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const url of urls) {
    const results = [];
    for (let run = 1; run <= runs; run += 1) {
      const result = await lighthouseModule.default(url, {
        port: chrome.port,
        logLevel: "error",
        output: ["json", "html"],
        onlyCategories: ["performance", "accessibility"],
      });
      if (!result?.lhr) throw new Error(`Lighthouse returned no result for ${url}`);
      results.push(result.lhr);
      const safeName =
        new URL(url).pathname.replaceAll(/[^a-z0-9]+/gi, "-").replaceAll(/^-|-$/g, "") || "home";
      const reports = Array.isArray(result.report) ? result.report : [result.report];
      const jsonPath = resolve(reportDir, `${safeName}-${run}.json`);
      const htmlPath = resolve(reportDir, `${safeName}-${run}.html`);
      await Promise.all([
        writeFile(jsonPath, reports[0] ?? JSON.stringify(result.lhr)),
        writeFile(htmlPath, reports[1] ?? renderFallbackHtml(result.lhr)),
      ]);
      htmlReports.push(htmlPath);
    }

    console.log(`[lighthouse] ${url}`);
    for (const check of checks) {
      const threshold = Number(thresholds[check.key]);
      if (!Number.isFinite(threshold)) continue;
      const values = results.map(check.read);
      if (values.some((value) => !Number.isFinite(value))) {
        fail(`${check.key}: metric unavailable`);
        continue;
      }
      const actual = check.mode === "min" ? lowerMedian(values) : upperMedian(values);
      const passed = check.mode === "min" ? actual >= threshold : actual <= threshold;
      console.log(
        `  ${passed ? "PASS" : "FAIL"} ${check.key}: ${actual.toFixed(3)} (${check.mode} ${threshold})`,
      );
      if (!passed) process.exitCode = 1;
    }
  }
  console.log("\n[lighthouse] HTML reports:");
  for (const path of htmlReports) console.log(`  ${path}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (chrome) await chrome.kill();
  qualityServer.kill("SIGTERM");
}

function renderFallbackHtml(lhr) {
  const escaped = JSON.stringify(lhr).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return `<!doctype html><meta charset="utf-8"><title>Lighthouse report</title><pre>${escaped}</pre>`;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolvePort(port);
        else reject(new Error("failed to allocate a quality server port"));
      });
    });
  });
}
