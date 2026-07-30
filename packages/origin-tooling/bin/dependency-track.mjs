#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEVERITY_RANK = new Map([
  ["none", Number.POSITIVE_INFINITY],
  ["unassigned", 0],
  ["info", 1],
  ["low", 2],
  ["medium", 3],
  ["high", 4],
  ["critical", 5],
]);
const POLICY_RANK = new Map([
  ["none", Number.POSITIVE_INFINITY],
  ["info", 1],
  ["warn", 2],
  ["fail", 3],
]);

const command = process.argv[2] ?? "publish";
if (!["publish", "upload", "gate"].includes(command)) {
  fail("usage: origin-dependency-track [publish|upload|gate]");
}

const cwd = process.cwd();
const packageJson = readJson(resolve(cwd, "package.json"), "package.json");
const configPath = resolve(
  cwd,
  process.env.DEPENDENCY_TRACK_CONFIG ?? "dependency-track.config.json",
);
const config = readJson(configPath, "Dependency-Track config");
const apiBaseUrl = normalizeApiBaseUrl(requiredEnv("DEPENDENCY_TRACK_URL"));
const apiKey = requiredEnv("DEPENDENCY_TRACK_API_KEY");
const projectName =
  process.env.DEPENDENCY_TRACK_PROJECT_NAME ?? config.projectName ?? packageJson.name;
const projectVersion =
  process.env.DEPENDENCY_TRACK_PROJECT_VERSION ?? config.projectVersion ?? packageJson.version;
const timeoutSeconds = positiveNumber(
  process.env.DEPENDENCY_TRACK_TIMEOUT_SECONDS ?? config.gate?.timeoutSeconds ?? 300,
  "timeoutSeconds",
);
const pollIntervalSeconds = positiveNumber(
  process.env.DEPENDENCY_TRACK_POLL_INTERVAL_SECONDS ?? config.gate?.pollIntervalSeconds ?? 2,
  "pollIntervalSeconds",
);

if (!projectName || !projectVersion) {
  fail("Dependency-Track projectName/projectVersion are required (config, env, or package.json)");
}

const context = { apiBaseUrl, apiKey, timeoutSeconds, pollIntervalSeconds };

if (command === "publish" || command === "upload") {
  const configuredBomPath = process.env.DEPENDENCY_TRACK_BOM_PATH ?? config.bomPath;
  if (typeof configuredBomPath !== "string" || configuredBomPath.length === 0) {
    fail("Dependency-Track config must define a non-empty bomPath");
  }
  const bomPath = resolve(cwd, configuredBomPath);
  const bomBytes = readFileSync(bomPath);
  validateBom(bomBytes, bomPath);

  const form = new FormData();
  form.set("autoCreate", String(config.autoCreate !== false));
  form.set("projectName", projectName);
  form.set("projectVersion", projectVersion);
  form.set("isLatest", String(config.isLatest === true));
  if (Array.isArray(config.tags) && config.tags.length > 0) {
    form.set("projectTags", config.tags.join(","));
  }
  form.set("bom", new Blob([bomBytes], { type: "application/vnd.cyclonedx+json" }), "bom.cdx.json");

  console.log(`[dependency-track] uploading ${projectName}@${projectVersion}`);
  const upload = await requestJson(context, "/v1/bom", { method: "POST", body: form });
  if (typeof upload?.token !== "string" || upload.token.length === 0) {
    fail("Dependency-Track accepted the request but did not return a processing token");
  }
  await waitForToken(context, upload.token);
  console.log(`[dependency-track] BOM processing completed (token ${upload.token})`);
}

if (command === "publish" && config.gate?.enabled === false) process.exit(0);
if (command === "publish" || command === "gate") {
  const project = await lookupProject(context, projectName, projectVersion);
  const gate = await evaluateGate(context, project.uuid, config.gate ?? {});
  printGate(gate, projectName, projectVersion);
  if (!gate.passed) process.exit(1);
}

async function waitForToken(context, token) {
  const deadline = Date.now() + context.timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const status = await requestJson(context, `/v1/event/token/${encodeURIComponent(token)}`);
    if (status?.processing === false) return;
    if (status?.processing !== true) fail("Dependency-Track returned an invalid event status");
    await delay(context.pollIntervalSeconds * 1_000);
  }
  fail(`Dependency-Track processing did not finish within ${context.timeoutSeconds}s`);
}

async function lookupProject(context, name, version) {
  const query = new URLSearchParams({ name, version });
  const project = await requestJson(context, `/v1/project/lookup?${query}`);
  if (typeof project?.uuid !== "string") fail("Dependency-Track project lookup returned no UUID");
  return project;
}

async function evaluateGate(context, projectUuid, gateConfig) {
  const severityThreshold = threshold(
    process.env.DEPENDENCY_TRACK_FAIL_ON_SEVERITY ?? gateConfig.failOnSeverity ?? "critical",
    SEVERITY_RANK,
    "failOnSeverity",
  );
  const policyThreshold = threshold(
    process.env.DEPENDENCY_TRACK_FAIL_ON_POLICY_VIOLATION ??
      gateConfig.failOnPolicyViolation ??
      "fail",
    POLICY_RANK,
    "failOnPolicyViolation",
  );
  const findings = await requestAll(
    context,
    `/v1/finding/project/${encodeURIComponent(projectUuid)}?suppressed=false`,
  );
  const violations = await requestAll(
    context,
    `/v1/violation/project/${encodeURIComponent(projectUuid)}?suppressed=false`,
  );

  const severityCounts = countBy(findings, (finding) =>
    String(finding?.vulnerability?.severity ?? "unassigned").toLowerCase(),
  );
  const policyCounts = countBy(violations, (violation) =>
    String(violation?.policy?.violationState ?? "unknown").toLowerCase(),
  );
  for (const severity of Object.keys(severityCounts)) {
    if (!SEVERITY_RANK.has(severity)) {
      fail(`Dependency-Track returned an unsupported vulnerability severity: ${severity}`);
    }
  }
  for (const state of Object.keys(policyCounts)) {
    if (!POLICY_RANK.has(state)) {
      fail(`Dependency-Track returned an unsupported policy violation state: ${state}`);
    }
  }
  const blockingFindings = findings.filter((finding) => {
    const rank = SEVERITY_RANK.get(
      String(finding?.vulnerability?.severity ?? "unassigned").toLowerCase(),
    );
    return rank !== undefined && rank >= severityThreshold.rank;
  });
  const blockingViolations = violations.filter((violation) => {
    const rank = POLICY_RANK.get(String(violation?.policy?.violationState ?? "").toLowerCase());
    return rank !== undefined && rank >= policyThreshold.rank;
  });

  return {
    passed: blockingFindings.length === 0 && blockingViolations.length === 0,
    findings: findings.length,
    violations: violations.length,
    severityCounts,
    policyCounts,
    blockingFindings: blockingFindings.length,
    blockingViolations: blockingViolations.length,
    severityThreshold: severityThreshold.name,
    policyThreshold: policyThreshold.name,
  };
}

function printGate(gate, projectName, projectVersion) {
  console.log(
    `[dependency-track] gate ${gate.passed ? "PASSED" : "FAILED"}: ${projectName}@${projectVersion}`,
  );
  console.log(
    `[dependency-track] findings=${gate.findings} ${formatCounts(gate.severityCounts)}; ` +
      `policy-violations=${gate.violations} ${formatCounts(gate.policyCounts)}`,
  );
  console.log(
    `[dependency-track] blocking: severity>=${gate.severityThreshold} ${gate.blockingFindings}, ` +
      `policy>=${gate.policyThreshold} ${gate.blockingViolations}`,
  );
}

async function requestJson(context, path, init = {}) {
  return (await requestJsonResponse(context, path, init)).data;
}

async function requestAll(context, path) {
  const items = [];
  const pageSize = 500;
  for (let pageNumber = 1; ; pageNumber += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await requestJsonResponse(
      context,
      `${path}${separator}pageNumber=${pageNumber}&pageSize=${pageSize}`,
    );
    if (!Array.isArray(response.data)) {
      fail("Dependency-Track gate endpoint returned an unexpected response");
    }
    items.push(...response.data);
    const totalHeader = response.headers.get("x-total-count");
    if (totalHeader === null) return items;
    const total = Number(totalHeader);
    if (!Number.isSafeInteger(total) || total < 0) {
      fail(`Dependency-Track returned an invalid X-Total-Count header: ${totalHeader}`);
    }
    if (items.length >= total) return items;
    if (response.data.length === 0) {
      fail(`Dependency-Track pagination stopped before all ${total} result(s) were returned`);
    }
  }
}

async function requestJsonResponse(context, path, init = {}) {
  let response;
  try {
    response = await fetch(`${context.apiBaseUrl}${path}`, {
      ...init,
      headers: { Accept: "application/json", "X-Api-Key": context.apiKey, ...init.headers },
      signal: AbortSignal.timeout(Math.min(context.timeoutSeconds * 1_000, 30_000)),
    });
  } catch (error) {
    fail(`Dependency-Track request failed for ${path}: ${error.message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    fail(`Dependency-Track ${response.status} ${response.statusText}: ${text.slice(0, 2_000)}`);
  }
  try {
    return { data: text.length > 0 ? JSON.parse(text) : null, headers: response.headers };
  } catch {
    fail(`Dependency-Track returned non-JSON from ${path}: ${text.slice(0, 500)}`);
  }
}

function validateBom(bytes, path) {
  let bom;
  try {
    bom = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`SBOM is not valid JSON: ${path}`);
  }
  if (
    bom?.bomFormat !== "CycloneDX" ||
    typeof bom?.specVersion !== "string" ||
    !bom?.metadata?.component ||
    !Array.isArray(bom?.components)
  ) {
    fail(`SBOM is not a valid CycloneDX application inventory: ${path}`);
  }
}

function normalizeApiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("DEPENDENCY_TRACK_URL must be an absolute URL, e.g. http://127.0.0.1:8081/api");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail("DEPENDENCY_TRACK_URL must be an http(s) URL without credentials, query, or fragment");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api") ? path : `${path}/api`;
  return url.toString().replace(/\/$/, "");
}

function threshold(value, ranks, field) {
  const name = String(value).toLowerCase();
  const rank = ranks.get(name);
  if (rank === undefined) fail(`${field} has an unsupported value: ${value}`);
  return { name, rank };
}

function countBy(items, select) {
  const counts = {};
  for (const item of items) {
    const key = select(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  return entries.length > 0 ? entries.map(([key, count]) => `${key}=${count}`).join(",") : "none";
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(`${field} must be a positive number`);
  return number;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Cannot read ${label} at ${path}: ${error.message}`);
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function fail(message) {
  console.error(`[dependency-track] ${message}`);
  process.exit(1);
}
