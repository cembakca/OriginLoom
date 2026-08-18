import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditProdCommand,
  ciScript,
  detectPackageManager,
  installCommand,
  isYarnClassic,
  lockfileFor,
  resolvePackageManager,
  spawnSpecForSbom,
  validateCycloneDxDocument,
  validateLockfileMatchesManager,
} from "../bin/lib/package-manager.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "origin-sbom-"));
  roots.push(root);
  mkdirSync(join(root, ".originloom"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture-app", version: "0.1.0", private: true }, null, 2) + "\n",
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(root, relativePath);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

describe("package-manager helpers", () => {
  it("detects lockfiles in priority order", () => {
    const root = fixture({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    expect(detectPackageManager(root)).toBe("pnpm");
  });

  it("prefers explicit override over lockfile detection", () => {
    const root = fixture({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    expect(detectPackageManager(root, "npm")).toBe("npm");
  });

  it("resolves declared metadata packageManager before detection", () => {
    const root = fixture({ "package-lock.json": "{}\n" });
    writeFileSync(
      join(root, ".originloom/project.json"),
      JSON.stringify({ packageManager: "npm" }, null, 2) + "\n",
    );
    expect(
      resolvePackageManager(root, {
        metadata: { packageManager: "npm" },
      }),
    ).toBe("npm");
  });

  it("maps install and audit commands per manager", () => {
    expect(installCommand("npm")).toBe("npm ci");
    expect(auditProdCommand("yarn")).toContain("yarn npm audit");
    expect(ciScript("npm")).toContain("npm run origin:doctor -- --strict");
  });

  it("flags yarn classic lockfiles", () => {
    const root = fixture({
      "yarn.lock": "# yarn lockfile v1\n\nreact@^19.0.0:\n",
    });
    expect(isYarnClassic(root)).toBe(true);
  });

  it("accepts berry yarn lockfiles", () => {
    const root = fixture({
      "yarn.lock": "__metadata:\n  version: 8\n",
    });
    expect(isYarnClassic(root)).toBe(false);
  });

  it("validates lockfile and manager alignment", () => {
    const root = fixture({ "package-lock.json": "{}\n" });
    expect(validateLockfileMatchesManager(root, "npm").ok).toBe(true);
    expect(validateLockfileMatchesManager(root, "pnpm").ok).toBe(false);
  });
});

describe("spawnSpecForSbom", () => {
  it("builds pnpm sbom arguments", () => {
    const root = fixture({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    const spec = spawnSpecForSbom("pnpm", {
      cwd: root,
      packageName: "fixture-app",
      outputPath: join(root, "artifacts/sbom/bom.cdx.json"),
      productionOnly: false,
    });
    expect(spec.args).toContain("--sbom-spec-version");
    expect(spec.args).toContain("1.6");
    expect(spec.args).toContain("fixture-app");
  });

  it("builds npm cyclonedx arguments when package-lock exists", () => {
    const root = fixture({ "package-lock.json": "{}\n" });
    const spec = spawnSpecForSbom("npm", {
      cwd: root,
      packageName: "fixture-app",
      outputPath: join(root, "artifacts/sbom/bom.cdx.json"),
      productionOnly: true,
    });
    expect(spec.command).toBe(process.execPath);
    expect(spec.args.some((arg) => arg.includes("cyclonedx-npm"))).toBe(true);
    expect(spec.args).toContain("--omit");
  });

  it("rejects yarn classic lockfiles", () => {
    const root = fixture({
      "yarn.lock": "# yarn lockfile v1\n",
    });
    expect(() =>
      spawnSpecForSbom("yarn", {
        cwd: root,
        packageName: "fixture-app",
        outputPath: join(root, "bom.cdx.json"),
        productionOnly: false,
      }),
    ).toThrow(/Yarn Classic/);
  });

  it("builds yarn berry dlx arguments", () => {
    const root = fixture({
      "yarn.lock": "__metadata:\n  version: 8\n",
    });
    const spec = spawnSpecForSbom("yarn", {
      cwd: root,
      packageName: "fixture-app",
      outputPath: join(root, "bom.cdx.json"),
      productionOnly: false,
    });
    expect(spec.args[0]).toBe("dlx");
    expect(spec.args).toContain("--sv");
  });
});

describe("validateCycloneDxDocument", () => {
  it("accepts a minimal cyclonedx 1.6 document", () => {
    const bom = validateCycloneDxDocument(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        metadata: { component: { name: "fixture-app" } },
        components: [],
      },
      "bom.cdx.json",
    );
    expect(bom.components).toEqual([]);
  });

  it("rejects unexpected spec versions", () => {
    expect(() =>
      validateCycloneDxDocument(
        {
          bomFormat: "CycloneDX",
          specVersion: "1.7",
          metadata: { component: { name: "fixture-app" } },
          components: [],
        },
        "bom.cdx.json",
      ),
    ).toThrow(/invalid/);
  });
});

describe("lockfileFor", () => {
  it("maps managers to lockfile names", () => {
    expect(lockfileFor("pnpm")).toBe("pnpm-lock.yaml");
    expect(lockfileFor("npm")).toBe("package-lock.json");
    expect(lockfileFor("yarn")).toBe("yarn.lock");
  });
});
