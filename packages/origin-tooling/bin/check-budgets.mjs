#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.cwd);
const configPath = resolve(root, options.config);
if (!existsSync(configPath)) fail(`Budget config not found: ${configPath}`);

const config = JSON.parse(readFileSync(configPath, "utf8"));
const assetRoot = resolve(root, config.assetRoot ?? "dist/client/assets");
if (!existsSync(assetRoot)) fail(`Build assets not found: ${assetRoot}; run pnpm build first.`);

const assets = readdirSync(assetRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const path = resolve(entry.parentPath, entry.name);
    const bytes = readFileSync(path);
    return {
      file: path.slice(assetRoot.length + 1),
      bytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes).byteLength,
    };
  });

const results = [];
for (const budget of config.assets ?? []) {
  const pattern = new RegExp(budget.pattern);
  const matches = assets.filter(({ file }) => pattern.test(file));
  if (matches.length === 0) {
    results.push({
      name: budget.name,
      status: budget.required === false ? "skip" : "fail",
      reason: "missing",
    });
    continue;
  }
  const gzipBytes = matches.reduce((total, asset) => total + asset.gzipBytes, 0);
  results.push({
    name: budget.name,
    status: gzipBytes <= budget.maxGzipBytes ? "pass" : "fail",
    gzipBytes,
    maxGzipBytes: budget.maxGzipBytes,
    files: matches.map(({ file }) => file),
  });
}

if (options.json) console.log(JSON.stringify({ assets, results }, null, 2));
else {
  for (const result of results) {
    const detail =
      result.reason === "missing"
        ? "required asset did not match"
        : `${formatBytes(result.gzipBytes)} / ${formatBytes(result.maxGzipBytes)} gzip${result.status === "fail" ? " (over budget)" : ""}`;
    console.log(
      `${result.status === "pass" ? "✓" : result.status === "skip" ? "-" : "✗"} ${result.name}: ${detail}`,
    );
  }
}
if (results.some(({ status }) => status === "fail")) process.exit(1);

function parseArgs(argv) {
  const parsed = { cwd: process.cwd(), config: "performance-budgets.json", json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--cwd") parsed.cwd = argv[++index];
    else if (arg === "--config") parsed.config = argv[++index];
    else if (arg === "--json") parsed.json = true;
    else fail(`Unknown option: ${arg}`);
  }
  return parsed;
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
