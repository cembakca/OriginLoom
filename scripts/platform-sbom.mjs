#!/usr/bin/env node
/**
 * Emit CycloneDX 1.6 SBOMs for each publishable @originloom/* package.
 * Used for release records alongside the workspace aggregate BOM (pnpm sbom).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { PACKAGES, repoRoot } from "./verdaccio-config.mjs";

const outputDir = join(repoRoot, "artifacts/sbom/packages");
mkdirSync(outputDir, { recursive: true });

for (const name of PACKAGES) {
  const packageName = `@originloom/${name}`;
  const outputPath = join(outputDir, `${name}.cdx.json`);
  const result = spawnSync(
    "pnpm",
    [
      "sbom",
      "--filter",
      packageName,
      "--sbom-format",
      "cyclonedx",
      "--sbom-spec-version",
      "1.6",
      "--sbom-type",
      "library",
      "--lockfile-only",
      "--out",
      outputPath,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`[sbom:packages] ${packageName} -> ${outputPath}`);
}
