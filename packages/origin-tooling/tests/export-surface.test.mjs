import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CORE_BLOCKED_SUBPATHS,
  CORE_TEMPLATE_SUBPATHS,
  REACT_TEMPLATE_SUBPATHS,
  SHARED_TEMPLATE_SUBPATHS,
} from "./export-surface.manifest.mjs";

const toolingRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(toolingRoot, "../..");
const templatesPath = join(toolingRoot, "bin/create-app/templates.mjs");
const templatesSource = readFileSync(templatesPath, "utf8");

const IMPORT_PATTERNS = [
  /\bfrom\s+["']@originloom\/(core|shared|react)\/([a-zA-Z0-9/_.-]+)["']/g,
  /\bimport\s*\(\s*["']@originloom\/(core|shared|react)\/([a-zA-Z0-9/_.-]+)["']\s*\)/g,
  /vi\.mock\s*\(\s*["']@originloom\/(core|shared|react)\/([a-zA-Z0-9/_.-]+)["']/g,
  /typeof\s+import\s*\(\s*["']@originloom\/(core|shared|react)\/([a-zA-Z0-9/_.-]+)["']\s*\)/g,
];

/** @param {string} pkg @param {string} source */
function collectSubpaths(pkg, source) {
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== pkg) continue;
      found.add(match[2]);
    }
  }
  return [...found].sort();
}

/** @param {string} subpath @param {readonly string[]} blockedPatterns */
function isCoreSubpathBlocked(subpath, blockedPatterns) {
  for (const pattern of blockedPatterns) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1);
      if (subpath.startsWith(prefix)) return true;
      continue;
    }
    if (subpath === pattern) return true;
  }
  return false;
}

/** @param {string} subpath */
function sharedModuleExists(subpath) {
  const base = join(repoRoot, "packages/origin-shared/src", subpath);
  return (
    existsSync(`${base}.ts`) ||
    existsSync(`${base}.tsx`) ||
    existsSync(join(base, "index.ts")) ||
    existsSync(join(base, "index.tsx"))
  );
}

/** @param {string} subpath */
function reactExportDeclared(subpath) {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "packages/origin-react/package.json"), "utf8"),
  );
  const key = `./${subpath}`;
  if (pkg.exports[key]) return true;
  if (subpath.startsWith("lib/") && pkg.exports["./lib/*"]) return true;
  return false;
}

describe("export surface — create-app template contract", () => {
  it("tracks every @originloom/core subpath the template imports", () => {
    const found = collectSubpaths("core", templatesSource);
    expect(found).toEqual([...CORE_TEMPLATE_SUBPATHS].sort());
  });

  it("tracks every @originloom/react subpath the template imports", () => {
    const found = collectSubpaths("react", templatesSource);
    expect(found).toEqual([...REACT_TEMPLATE_SUBPATHS].sort());
  });

  it("tracks every @originloom/shared subpath the template imports", () => {
    const found = collectSubpaths("shared", templatesSource);
    expect(found).toEqual([...SHARED_TEMPLATE_SUBPATHS].sort());
  });

  it("does not import blocked @originloom/core pipeline internals", () => {
    const found = collectSubpaths("core", templatesSource);
    const violations = found.filter((subpath) => isCoreSubpathBlocked(subpath, CORE_BLOCKED_SUBPATHS));
    expect(violations).toEqual([]);
  });

  it("resolves shared template imports to real modules", () => {
    for (const subpath of SHARED_TEMPLATE_SUBPATHS) {
      expect(sharedModuleExists(subpath), `missing shared module for ${subpath}`).toBe(true);
    }
  });

  it("uses only declared @originloom/react export entries", () => {
    for (const subpath of REACT_TEMPLATE_SUBPATHS) {
      expect(reactExportDeclared(subpath), `undeclared react export ./${subpath}`).toBe(true);
    }
  });
});

describe("export surface — @originloom/core blocked list", () => {
  it("matches package.json null exports", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "packages/origin-core/package.json"), "utf8"),
    );
    const blocked = Object.entries(pkg.exports)
      .filter(([, target]) => target === null)
      .map(([subpath]) => subpath.replace(/^\.\//, ""))
      .sort();
    expect([...CORE_BLOCKED_SUBPATHS].sort()).toEqual(blocked);
  });
});
