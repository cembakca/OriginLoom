import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  CORE_PUBLIC_SUBPATHS,
  REACT_PUBLIC_SUBPATHS,
  SHARED_PUBLIC_SUBPATHS,
} from "./package-surface.manifest.mjs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const PACKAGES = [
  { name: "shared", manifest: SHARED_PUBLIC_SUBPATHS },
  { name: "core", manifest: CORE_PUBLIC_SUBPATHS },
  { name: "react", manifest: REACT_PUBLIC_SUBPATHS },
];

/** @param {string} pkg */
function packageRoot(pkg) {
  return join(repoRoot, `packages/origin-${pkg}`);
}

/** @param {string} pkg */
function blockedPatterns(pkg) {
  const exports = JSON.parse(readFileSync(join(packageRoot(pkg), "package.json"), "utf8")).exports;
  return Object.entries(exports)
    .filter(([, target]) => target === null)
    .map(([key]) => key.slice(2));
}

/** @param {string} subpath @param {readonly string[]} patterns */
function isBlocked(subpath, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith("/*") ? subpath.startsWith(pattern.slice(0, -1)) : subpath === pattern,
  );
}

/** Every module the wildcard in `exports` makes importable. */
async function reachableSubpaths(pkg) {
  const src = join(packageRoot(pkg), "src");
  const blocked = blockedPatterns(pkg);
  const found = new Set();
  for await (const entry of glob("**/*.{ts,tsx}", { cwd: src })) {
    const withoutExtension = entry.slice(0, entry.lastIndexOf("."));
    if (withoutExtension.endsWith(".d")) continue;
    for (const candidate of withoutExtension.endsWith("/index")
      ? [withoutExtension, withoutExtension.slice(0, -"/index".length)]
      : [withoutExtension]) {
      if (!isBlocked(candidate, blocked)) found.add(candidate);
    }
  }
  return [...found].sort();
}

describe("published package surface", () => {
  for (const { name, manifest } of PACKAGES) {
    /**
     * A new source file becomes importable the moment it exists, so this is the
     * step that turns "it happens to be exported" into "we decided it is API".
     */
    it(`@originloom/${name} exposes exactly the subpaths the manifest pins`, async () => {
      expect(await reachableSubpaths(name)).toEqual([...manifest].sort());
    });

    it(`@originloom/${name} manifest has no stale entries`, async () => {
      const root = join(packageRoot(name), "src");
      const missing = manifest.filter(
        (subpath) =>
          !existsSync(join(root, `${subpath}.ts`)) &&
          !existsSync(join(root, `${subpath}.tsx`)) &&
          !existsSync(join(root, subpath, "index.ts")) &&
          !existsSync(join(root, subpath, "index.tsx")),
      );
      expect(missing).toEqual([]);
    });
  }
});
