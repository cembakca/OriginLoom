#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const cwd = process.cwd();
const packageJsonPath = resolve(cwd, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const productionOnly = process.argv.includes("--prod");
const outputPath = resolve(
  cwd,
  process.env.ORIGINLOOM_SBOM_PATH ??
    (productionOnly ? "artifacts/sbom/bom.production.cdx.json" : "artifacts/sbom/bom.cdx.json"),
);

if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
  throw new Error("package.json must define a non-empty name before an SBOM can be generated");
}

mkdirSync(dirname(outputPath), { recursive: true });

const args = [
  "sbom",
  "--filter",
  packageJson.name,
  "--sbom-format",
  "cyclonedx",
  // Dependency-Track 4.14 and 5.x both accept CycloneDX 1.6. Using 1.7 here
  // would reject otherwise valid uploads on supported 4.14 installations.
  "--sbom-spec-version",
  "1.6",
  "--sbom-type",
  "application",
  "--lockfile-only",
  "--out",
  outputPath,
  ...(productionOnly ? ["--prod"] : []),
];

const npmExecPath = process.env.npm_execpath;
const result = npmExecPath
  ? spawnSync(process.execPath, [npmExecPath, ...args], { cwd, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
      cwd,
      stdio: "inherit",
    });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const bom = JSON.parse(readFileSync(outputPath, "utf8"));
if (
  bom.bomFormat !== "CycloneDX" ||
  bom.specVersion !== "1.6" ||
  !bom.metadata?.component ||
  !Array.isArray(bom.components)
) {
  throw new Error(`pnpm generated an invalid or unexpected CycloneDX document: ${outputPath}`);
}

console.log(
  `[sbom] ${bom.components.length} component(s) -> ${outputPath}${productionOnly ? " (production only)" : ""}`,
);
