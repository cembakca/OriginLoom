import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const DOCTOR = fileURLToPath(new URL("../bin/doctor.mjs", import.meta.url));
const MIGRATE = fileURLToPath(new URL("../bin/migrate.mjs", import.meta.url));
const TOOLING_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;
const scratchDirectories = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("origin-doctor", () => {
  it("accepts a healthy generated project and emits machine-readable output", () => {
    const root = project({ version: TOOLING_VERSION, metadata: true });
    const result = run(DOCTOR, ["--cwd", root, "--strict", "--json"]);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.templateVersion).toBe(TOOLING_VERSION);
    expect(report.findings).toEqual([expect.objectContaining({ severity: "ok", code: "healthy" })]);
  });

  it("reports fixed-group range drift without modifying the project", () => {
    const root = project({ version: TOOLING_VERSION, metadata: true });
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.dependencies["@originloom/core"] = "^9.9.9";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const drifted = readFileSync(manifestPath, "utf8");

    const result = run(DOCTOR, ["--cwd", root, "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).findings).toContainEqual(
      expect.objectContaining({ severity: "error", code: "package-range-drift" }),
    );
    expect(readFileSync(manifestPath, "utf8")).toBe(drifted);
  });
});

describe("origin-migrate", () => {
  it("plans, applies and idempotently verifies a 0.5.12 project", () => {
    const root = project({ version: "0.5.12", metadata: false });
    const manifestPath = join(root, "package.json");
    const original = readFileSync(manifestPath, "utf8");

    const dryRun = run(MIGRATE, ["--cwd", root]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain("Dry-run");
    expect(readFileSync(manifestPath, "utf8")).toBe(original);
    expect(existsSync(join(root, ".originloom/project.json"))).toBe(false);

    const applied = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(applied.status).toBe(0);
    const migratedPackage = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(migratedPackage.scripts["origin:doctor"]).toBe("origin-doctor");
    expect(migratedPackage.scripts["origin:migrate"]).toBe("origin-migrate");
    expect(migratedPackage.scripts.ci).toContain("origin:doctor --strict");
    expect(migratedPackage.dependencies["@originloom/core"]).toBe("^" + TOOLING_VERSION);
    expect(migratedPackage.devDependencies["@originloom/tooling"]).toBe("^" + TOOLING_VERSION);
    expect(migratedPackage.engines.node).toBe(">=22.13.0");
    expect(migratedPackage.devDependencies["@eslint/js"]).toBe("^10.0.1");
    expect(migratedPackage.devDependencies.eslint).toBe("^10.8.0");
    expect(migratedPackage.scripts.test).toBe("vitest run tests");

    const metadata = JSON.parse(readFileSync(join(root, ".originloom/project.json"), "utf8"));
    expect(metadata.templateVersion).toBe(TOOLING_VERSION);
    expect(metadata.appliedMigrations).toContain("0.5.14-upgrade-contract-v1");
    expect(metadata.appliedMigrations).toContain("0.5.17-eslint-10");
    expect(metadata.appliedMigrations).toContain("0.5.18-vitest-scope");
    expect(existsSync(join(root, "docs/upgrading.md"))).toBe(true);
    expect(
      existsSync(join(root, ".originloom/backups", "0.5.12-to-" + TOOLING_VERSION, "package.json")),
    ).toBe(true);

    const second = run(MIGRATE, ["--cwd", root]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Uygulanacak değişiklik yok");

    const doctor = run(DOCTOR, ["--cwd", root, "--strict"]);
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("[healthy]");
  });

  it("refuses unsupported old projects instead of skipping migration steps", () => {
    const root = project({ version: "0.4.9", metadata: false });
    const result = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("otomatik migration desteklenmiyor");
  });
});

function project({ version, metadata }) {
  const root = mkdtempSync(join(tmpdir(), "originloom-upgrade-"));
  scratchDirectories.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "upgrade-fixture",
        private: true,
        type: "module",
        scripts: metadata
          ? {
              "origin:doctor": "origin-doctor",
              "origin:migrate": "origin-migrate",
              ci: "pnpm run origin:doctor --strict && pnpm run typecheck",
            }
          : { ci: "pnpm run typecheck" },
        dependencies: {
          "@originloom/shared": "^" + version,
          "@originloom/core": "^" + version,
          "@originloom/react": "^" + version,
        },
        engines: metadata ? { node: ">=22.13.0" } : undefined,
        devDependencies: {
          "@originloom/tooling": "^" + version,
          ...(metadata ? { "@eslint/js": "^10.0.1", eslint: "^10.8.0" } : {}),
        },
      },
      null,
      2,
    ) + "\n",
  );
  if (metadata) {
    mkdirSync(join(root, ".originloom"), { recursive: true });
    writeFileSync(
      join(root, ".originloom/project.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          templateVersion: version,
          platformRange: "^" + version,
          renderer: "react",
          mode: "standalone",
          generatedBy: "@originloom/tooling",
          appliedMigrations: [
            "0.5.14-upgrade-contract-v1",
            "0.5.17-eslint-10",
            "0.5.18-vitest-scope",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  }
  return root;
}

function run(cli, args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}
