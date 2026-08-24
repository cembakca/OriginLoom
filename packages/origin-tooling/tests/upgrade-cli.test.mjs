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
    expect(migratedPackage.engines.node).toBe(">=24.18.1");
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
    expect(metadata.appliedMigrations).toContain("0.7.16-ssr-capacity");
    expect(metadata.appliedMigrations).toContain("0.7.17-dev-experience");
    expect(metadata.appliedMigrations).toContain("0.7.18-dev-experience-source-patches");
    expect(metadata.appliedMigrations).toContain("0.7.18-generation-aware-dev-reload");
    expect(metadata.appliedMigrations).toContain("0.7.21-client-entry-telemetry-import-fix");
    expect(metadata.appliedMigrations).toContain("0.7.22-ssr-error-reference");
    expect(metadata.appliedMigrations).toContain("0.7.20-hono-4.13");
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
    expect(migrated.engines.node).toBe(">=24.18.1");
    expect(migrated.devDependencies.lighthouse).toBe("^13.4.1");
    expect(migrated.pnpm.overrides).toEqual({ "autocannon>hyperid": "^4.0.0" });
  });

  it("migrates Hono and its Node adapter through the security and 4.13 releases", () => {
    const root = project({ version: "0.7.11", metadata: true });
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.dependencies.hono = "^4.12.32";
    manifest.dependencies["@hono/node-server"] = "^2.0.12";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const result = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(result.status).toBe(0);
    const migrated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(migrated.dependencies.hono).toBe("^4.13.3");
    expect(migrated.dependencies["@hono/node-server"]).toBe("^2.1.1");
    const metadata = JSON.parse(readFileSync(join(root, ".originloom/project.json"), "utf8"));
    expect(metadata.appliedMigrations).toContain("0.7.12-hono-ssr-security");
    expect(metadata.appliedMigrations).toContain("0.7.20-hono-4.13");
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
    expect(readFileSync(join(root, "src/styles/globals.css"), "utf8")).toContain(
      "@view-transition",
    );

    const metadata = JSON.parse(readFileSync(join(root, ".originloom/project.json"), "utf8"));
    expect(metadata.appliedMigrations).toContain("0.7.15-navigation-paint");
    expect(metadata.appliedMigrations).toContain("0.7.16-ssr-capacity");
    expect(metadata.appliedMigrations).toContain("0.7.17-dev-experience");
    expect(metadata.appliedMigrations).toContain("0.7.18-dev-experience-source-patches");
    expect(metadata.templateVersion).toBe(TOOLING_VERSION);
  });

  it("patches known 0.7.17 dev-experience files and stays idempotent", () => {
    const root = project({ version: "0.7.17", metadata: true });
    const metadataPath = join(root, ".originloom/project.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.appliedMigrations.push("0.7.17-dev-experience");
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, ".svgrrc.cjs"),
      `module.exports = {
  svgoConfig: {
    plugins: [
      { name: "preset-default" },
      {
        name: "convertColors",
        params: { currentColor: true },
      },
    ],
  },
};
`,
    );
    writeFileSync(
      join(root, "src/entry.client.tsx"),
      `import { signalReactReady } from "@originloom/shared/lib/analytics/data-layer";
import { reportClientError } from "@originloom/shared/lib/client/error-telemetry";
import { runIslandBootstrap } from "@originloom/shared/lib/client/island-runtime";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";

installReloadButtons();
runIslandBootstrap(() => reportClientError("island-bootstrap", new Error("failed")));
`,
    );
    writeFileSync(
      join(root, "vite.config.ts"),
      `import { resolve } from "node:path";

export default {
  entry: resolve(__dirname, "src/entry.client.tsx"),
  alias: { "~": resolve(__dirname, "src") },
  reload: {
    shouldReload: (file) =>
      file.includes("/server/") ||
      file.includes("/src/features/") ||
      file.includes("/src/components/") ||
      file.endsWith("/src/lib/island.tsx"),
  },
};
`,
    );

    const applied = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(applied.status).toBe(0);
    expect(readFileSync(join(root, ".svgrrc.cjs"), "utf8")).toContain(
      '{ name: "convertStyleToAttrs" }',
    );
    const clientEntry = readFileSync(join(root, "src/entry.client.tsx"), "utf8");
    expect(clientEntry).toContain("logPageRequestIdInDev,");
    expect(clientEntry).toContain("logPageRequestIdInDev();");
    expect(clientEntry).toContain(
      'import { signalReactReady } from "@originloom/shared/lib/analytics/data-layer";',
    );
    expect(clientEntry).not.toMatch(
      /logPageRequestIdInDev[^}]*from "@originloom\/shared\/lib\/analytics\/data-layer"/,
    );
    const viteConfig = readFileSync(join(root, "vite.config.ts"), "utf8");
    expect(viteConfig).not.toContain("__dirname");
    expect(viteConfig).toContain("import.meta.dirname");
    expect(viteConfig).toContain("reload: {}");
    expect(viteConfig).not.toContain("shouldReload");

    const snapshots = [".svgrrc.cjs", "src/entry.client.tsx", "vite.config.ts"].map((path) =>
      readFileSync(join(root, path), "utf8"),
    );
    const second = run(MIGRATE, ["--cwd", root]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Uygulanacak değişiklik yok");
    expect(
      [".svgrrc.cjs", "src/entry.client.tsx", "vite.config.ts"].map((path) =>
        readFileSync(join(root, path), "utf8"),
      ),
    ).toEqual(snapshots);
  });

  it("repairs the malformed analytics import produced by the old client-entry patch", () => {
    const root = project({ version: TOOLING_VERSION, metadata: true });
    const metadataPath = join(root, ".originloom/project.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.appliedMigrations = metadata.appliedMigrations.filter(
      (id) => id !== "0.7.21-client-entry-telemetry-import-fix",
    );
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src/entry.client.tsx"),
      `import {
  logPageRequestIdInDev,
  signalReactReady
} from "@originloom/shared/lib/analytics/data-layer";
import { reportClientError } from "@originloom/shared/lib/client/error-telemetry";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";

installReloadButtons();
logPageRequestIdInDev();
signalReactReady();
reportClientError("island-bootstrap", new Error("failed"));
`,
    );

    const applied = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(applied.status).toBe(0);
    const clientEntry = readFileSync(join(root, "src/entry.client.tsx"), "utf8");
    expect(clientEntry).toContain(
      'import { signalReactReady } from "@originloom/shared/lib/analytics/data-layer";',
    );
    expect(clientEntry).toMatch(
      /import\s*\{[^}]*logPageRequestIdInDev[^}]*reportClientError[^}]*\}\s*from\s*"@originloom\/shared\/lib\/client\/error-telemetry"/,
    );
    expect(clientEntry).not.toMatch(
      /logPageRequestIdInDev[^}]*from "@originloom\/shared\/lib\/analytics\/data-layer"/,
    );
    const repairedMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    expect(repairedMetadata.appliedMigrations).toContain(
      "0.7.21-client-entry-telemetry-import-fix",
    );
  });

  it("restores telemetry after the malformed import and call were removed manually", () => {
    const root = project({ version: TOOLING_VERSION, metadata: true });
    const metadataPath = join(root, ".originloom/project.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.appliedMigrations = metadata.appliedMigrations.filter(
      (id) => id !== "0.7.21-client-entry-telemetry-import-fix",
    );
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src/entry.client.tsx"),
      `import { signalReactReady } from "@originloom/shared/lib/analytics/data-layer";
import { reportClientError } from "@originloom/shared/lib/client/error-telemetry";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";

installReloadButtons();
signalReactReady();
reportClientError("island-bootstrap", new Error("failed"));
`,
    );

    const applied = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(applied.status).toBe(0);
    const clientEntry = readFileSync(join(root, "src/entry.client.tsx"), "utf8");
    expect(clientEntry).toMatch(
      /import\s*\{[^}]*logPageRequestIdInDev[^}]*reportClientError[^}]*\}\s*from\s*"@originloom\/shared\/lib\/client\/error-telemetry"/,
    );
    expect(clientEntry).toContain("installReloadButtons();\nlogPageRequestIdInDev();");
  });

  it("adds the structured-log reference to a known generated error boundary", () => {
    const root = project({ version: TOOLING_VERSION, metadata: true });
    const metadataPath = join(root, ".originloom/project.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.appliedMigrations = metadata.appliedMigrations.filter(
      (id) => id !== "0.7.22-ssr-error-reference",
    );
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    mkdirSync(join(root, "server/product"), { recursive: true });
    writeFileSync(
      join(root, "server/product/boundary-pages.tsx"),
      `import type { RouteError } from "@originloom/react/lib/types";

export function RouteErrorPage({ error }: { error: RouteError | null; status: number }) {
  return (
    <div>
      <p className="text-slate-600">{error?.message ?? "Lütfen daha sonra tekrar deneyin."}</p>
    </div>
  );
}
`,
    );

    const applied = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(applied.status).toBe(0);
    const boundary = readFileSync(join(root, "server/product/boundary-pages.tsx"), "utf8");
    expect(boundary).toContain("RouteErrorBoundaryProps");
    expect(boundary).toContain("RouteErrorPage({ error, errorId }");
    expect(boundary).toContain("Referans: {errorId}");

    const second = run(MIGRATE, ["--cwd", root]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Uygulanacak değişiklik yok");
  });

  it("reports a custom error boundary as manual-required and never marks it applied", () => {
    const root = project({ version: TOOLING_VERSION, metadata: true });
    const metadataPath = join(root, ".originloom/project.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.appliedMigrations = metadata.appliedMigrations.filter(
      (id) => id !== "0.7.22-ssr-error-reference",
    );
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    mkdirSync(join(root, "server/product"), { recursive: true });
    const customBoundary = `import type { RouteError } from "@originloom/react/lib/types";

export function RouteErrorPage({ error, status }: { error: RouteError | null; status: number }) {
  return (
    <div className="custom-error-shell">
      <p>{status} — something custom happened.</p>
      <p>{error?.message}</p>
    </div>
  );
}
`;
    writeFileSync(join(root, "server/product/boundary-pages.tsx"), customBoundary);

    const applied = run(MIGRATE, ["--cwd", root, "--apply"]);
    // A pending manual-required change must not report success: automation
    // checking the exit code needs to see this upgrade as incomplete.
    expect(applied.status).toBe(1);
    expect(applied.stdout).toContain("Elle müdahale gerekiyor");
    expect(applied.stdout).toContain("server/product/boundary-pages.tsx");
    expect(applied.stdout).toContain("Migration kısmen tamamlandı");

    // The custom file must be left untouched — no blind regex rewrite of a non-matching file.
    expect(readFileSync(join(root, "server/product/boundary-pages.tsx"), "utf8")).toBe(
      customBoundary,
    );

    // The migration must not be recorded as applied.
    const nextMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    expect(nextMetadata.appliedMigrations).not.toContain("0.7.22-ssr-error-reference");

    // origin:doctor --strict keeps reporting it as pending.
    const doctorResult = run(DOCTOR, ["--cwd", root, "--strict", "--json"]);
    expect(doctorResult.status).toBe(1);
    const report = JSON.parse(doctorResult.stdout);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "migration-pending" }));

    // Re-running migrate stays idempotent: same manual-required report, no crash.
    const second = run(MIGRATE, ["--cwd", root, "--apply"]);
    expect(second.status).toBe(1);
    expect(second.stdout).toContain("Elle müdahale gerekiyor");
    expect(readFileSync(join(root, "server/product/boundary-pages.tsx"), "utf8")).toBe(
      customBoundary,
    );
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
          "@hono/node-server": "^2.1.1",
          hono: "^4.13.3",
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
                  "0.7.16-ssr-capacity",
                  "0.7.17-dev-experience",
                  "0.7.18-dev-experience-source-patches",
                  "0.7.18-generation-aware-dev-reload",
                  "0.7.21-client-entry-telemetry-import-fix",
                  "0.7.22-ssr-error-reference",
                  "0.7.20-hono-4.13",
                  "0.7.23-cache-performance-acceptance",
                  "0.7.24-warm-path-performance",
                  "0.7.26-node-24",
                  "0.7.32-devtools-client-option",
                  "0.7.32-shutdown-drain-order",
                  "0.7.34-disposable-gateway-response",
                  "0.7.52-json-schema-contracts",
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
