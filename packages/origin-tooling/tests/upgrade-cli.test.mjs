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

  it("reports package manager lockfile drift", () => {
    const root = project({ version: TOOLING_VERSION, metadata: true });
    rmSync(join(root, "pnpm-lock.yaml"));
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    const result = run(DOCTOR, ["--cwd", root, "--strict", "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).findings).toContainEqual(
      expect.objectContaining({ code: "package-manager-lockfile" }),
    );
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
    expect(metadata.appliedMigrations).toContain("0.5.34-react-quality-security");
    expect(metadata.appliedMigrations).toContain("0.5.35-route-build-manifest");
    expect(metadata.appliedMigrations).toContain("0.7.3-gateway-identity");
    expect(metadata.appliedMigrations).toContain("0.7.11-plugin-schema-v2");
    expect(metadata.appliedMigrations).toContain("0.7.12-hono-ssr-security");
    expect(metadata.appliedMigrations).toContain("0.7.14-public-static");
    expect(metadata.appliedMigrations).toContain("0.7.14-scaffold-gateway");
    expect(metadata.appliedMigrations).toContain("0.7.15-navigation-paint");
    expect(metadata.schemaVersion).toBe(2);
    expect(metadata.plugins).toEqual([]);
    expect(existsSync(join(root, "public/README.md"))).toBe(true);
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

  it("migrates React quality dependencies away from unsupported and vulnerable chains", () => {
    const root = project({ version: "0.5.33", metadata: true });
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.devDependencies.lighthouse = "^12.8.2";
    manifest.devDependencies.autocannon = "^8.0.0";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const result = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(result.status).toBe(0);
    const migrated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(migrated.engines.node).toBe(">=22.19.0");
    expect(migrated.devDependencies.lighthouse).toBe("^13.4.1");
    expect(migrated.pnpm.overrides).toEqual({ "autocannon>hyperid": "^4.0.0" });
  });

  it("migrates vulnerable Hono versions to the patched SSR security release", () => {
    const root = project({ version: "0.7.11", metadata: true });
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.dependencies.hono = "^4.12.32";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const result = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(result.status).toBe(0);
    const migrated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(migrated.dependencies.hono).toBe("^4.12.34");
    const metadata = JSON.parse(readFileSync(join(root, ".originloom/project.json"), "utf8"));
    expect(metadata.appliedMigrations).toContain("0.7.12-hono-ssr-security");
  });

  it("migrates 0.7.13 projects to public static files and gateway scaffold script", () => {
    const root = project({ version: "0.7.13", metadata: true });
    writeFileSync(
      join(root, ".originloom/project.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          templateVersion: "0.7.13",
          platformRange: "^0.7.13",
          renderer: "react",
          mode: "standalone",
          packageManager: "pnpm",
          generatedBy: "@originloom/tooling",
          plugins: [],
          appliedMigrations: [
            "0.5.14-upgrade-contract-v1",
            "0.5.17-eslint-10",
            "0.5.18-vitest-scope",
            "0.5.34-react-quality-security",
            "0.5.35-route-build-manifest",
            "0.5.36-product-middleware",
            "0.6.0-gateway-backed-streaming",
            "0.7.0-react-only",
            "0.7.3-gateway-identity",
            "0.7.11-plugin-schema-v2",
            "0.7.12-hono-ssr-security",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.scripts["contracts:fixtures"] = "origin-check-contracts";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(
      join(root, "Dockerfile"),
      [
        "FROM node:22-alpine AS builder",
        "WORKDIR /app",
        "RUN pnpm build",
        "FROM node:22-alpine AS runner",
        "WORKDIR /app",
        "COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist",
        'CMD ["node", "dist/server/index.js"]',
        "",
      ].join("\n"),
    );

    const result = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(result.status).toBe(0);

    const migrated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(migrated.dependencies["@originloom/core"]).toBe("^" + TOOLING_VERSION);
    expect(migrated.scripts["contracts:scaffold"]).toBe("origin-scaffold-gateway");
    expect(existsSync(join(root, "public/README.md"))).toBe(true);
    expect(existsSync(join(root, "public/test.img"))).toBe(true);
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toContain(
      "COPY --from=builder --chown=nodejs:nodejs /app/public ./public",
    );

    const metadata = JSON.parse(readFileSync(join(root, ".originloom/project.json"), "utf8"));
    expect(metadata.appliedMigrations).toContain("0.7.14-public-static");
    expect(metadata.appliedMigrations).toContain("0.7.14-scaffold-gateway");
  });

  it("migrates 0.7.14 projects to view-transition CSS", () => {
    const root = project({ version: "0.7.14", metadata: true });
    writeFileSync(
      join(root, ".originloom/project.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          templateVersion: "0.7.14",
          platformRange: "^0.7.14",
          renderer: "react",
          mode: "standalone",
          packageManager: "pnpm",
          generatedBy: "@originloom/tooling",
          plugins: [],
          appliedMigrations: [
            "0.5.14-upgrade-contract-v1",
            "0.5.17-eslint-10",
            "0.5.18-vitest-scope",
            "0.5.34-react-quality-security",
            "0.5.35-route-build-manifest",
            "0.5.36-product-middleware",
            "0.6.0-gateway-backed-streaming",
            "0.7.0-react-only",
            "0.7.3-gateway-identity",
            "0.7.11-plugin-schema-v2",
            "0.7.12-hono-ssr-security",
            "0.7.14-public-static",
            "0.7.14-scaffold-gateway",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    mkdirSync(join(root, "src/styles"), { recursive: true });
    writeFileSync(
      join(root, "src/styles/globals.css"),
      '@import "tailwindcss";\n\nbody {\n  font-family: sans-serif;\n}\n',
    );

    const result = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "src/styles/globals.css"), "utf8")).toContain("@view-transition");

    const metadata = JSON.parse(readFileSync(join(root, ".originloom/project.json"), "utf8"));
    expect(metadata.appliedMigrations).toContain("0.7.15-navigation-paint");
    expect(metadata.templateVersion).toBe(TOOLING_VERSION);
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
          schemaVersion: version === TOOLING_VERSION ? 2 : 1,
          templateVersion: version,
          platformRange: "^" + version,
          renderer: "react",
          mode: "standalone",
          packageManager: "pnpm",
          generatedBy: "@originloom/tooling",
          ...(version === TOOLING_VERSION ? { plugins: [] } : {}),
          appliedMigrations: [
            "0.5.14-upgrade-contract-v1",
            "0.5.17-eslint-10",
            "0.5.18-vitest-scope",
            ...(version === TOOLING_VERSION
              ? [
                  "0.5.34-react-quality-security",
                  "0.5.35-route-build-manifest",
                  "0.5.36-product-middleware",
                  "0.6.0-gateway-backed-streaming",
                  "0.7.0-react-only",
                  "0.7.3-gateway-identity",
                  "0.7.11-plugin-schema-v2",
                  "0.7.12-hono-ssr-security",
                  "0.7.14-public-static",
                  "0.7.14-scaffold-gateway",
                  "0.7.15-navigation-paint",
                ]
              : []),
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
