#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  parsePmFlag,
  readPackageJson,
  readProjectMetadata,
  resolvePackageManager,
  spawnSpecForSbom,
  validateCycloneDxDocument,
} from "./lib/package-manager.mjs";

const cwd = process.cwd();
const argv = process.argv.slice(2);
const productionOnly = argv.includes("--prod");
const override = parsePmFlag(argv);
const packageJson = readPackageJson(cwd);
const metadata = readProjectMetadata(cwd);
const pm = resolvePackageManager(cwd, { override, metadata, packageJson });
const outputPath = resolve(
  cwd,
  process.env.ORIGINLOOM_SBOM_PATH ??
    (productionOnly ? "artifacts/sbom/bom.production.cdx.json" : "artifacts/sbom/bom.cdx.json"),
);

if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
  throw new Error("package.json must define a non-empty name before an SBOM can be generated");
}

mkdirSync(dirname(outputPath), { recursive: true });

const spec = spawnSpecForSbom(pm, {
  cwd,
  packageName: packageJson.name,
  outputPath,
  productionOnly,
});

const npmExecPath = process.env.npm_execpath;
const result =
  pm === "pnpm" && npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...spec.args], { cwd, stdio: "inherit" })
    : spawnSync(spec.command, spec.args, {
        cwd,
        stdio: "inherit",
        shell: spec.shell,
      });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const bom = validateCycloneDxDocument(JSON.parse(readFileSync(outputPath, "utf8")), outputPath);

console.log(
  `[sbom:${pm}] ${bom.components.length} component(s) -> ${outputPath}${productionOnly ? " (production only)" : ""}`,
);
