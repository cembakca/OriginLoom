import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Publishing turns every reachable subpath into a promise. The pipeline
 * internals are deliberately shut (`null` targets) so they stay free to change;
 * these assertions keep the two export maps honest about what is shut, and make
 * sure nothing outside the package depends on it.
 */
const packageRoot = join(import.meta.dirname, "..");
const workspaceRoot = join(packageRoot, "../..");

type ExportMap = Record<string, unknown>;

const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  exports: ExportMap;
  publishConfig: { exports: ExportMap };
};

const blocked = (map: ExportMap): string[] =>
  Object.entries(map)
    .filter(([, target]) => target === null)
    .map(([subpath]) => subpath);

/** `./ssr/*` → every module under src/ssr; `./public-url` → that one module. */
function modulesBehind(subpath: string): string[] {
  const relative = subpath.replace(/^\.\//, "");
  if (!relative.endsWith("/*")) {
    const base = join(packageRoot, "src", relative);
    return [`${base}.ts`, `${base}.tsx`].filter((file) => existsSync(file));
  }
  const directory = join(packageRoot, "src", relative.slice(0, -2));
  if (!existsSync(directory)) return [];
  return execSync(`find ${directory} -name '*.ts' -o -name '*.tsx'`, { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

describe("@originloom/core public API", () => {
  it("blocks the same subpaths in development and in the published package", () => {
    expect(blocked(pkg.publishConfig.exports)).toEqual(blocked(pkg.exports));
  });

  it("blocks subpaths that exist", () => {
    for (const subpath of blocked(pkg.exports)) {
      expect(modulesBehind(subpath), `${subpath} matches no module`).not.toEqual([]);
    }
  });

  it("blocks nothing anyone outside the package imports", () => {
    // The whole repo except this package's own sources.
    const importers = execSync(
      `grep -rho "@originloom/core/[a-zA-Z0-9/_.-]*" ${workspaceRoot}/apps ${workspaceRoot}/packages ` +
        `--exclude-dir=node_modules --exclude-dir=dist || true`,
      { encoding: "utf8" },
    )
      .split(/\s+/)
      .filter(Boolean)
      .map((specifier) => specifier.replace(/[.,;:)"'`]+$/, "").replace("@originloom/core/", ""));

    const shut = new Set(
      blocked(pkg.exports).flatMap((subpath) =>
        modulesBehind(subpath).map((file) =>
          file
            .slice(join(packageRoot, "src/").length)
            .replace(/\.tsx?$/, "")
            .replace(/\/index$/, ""),
        ),
      ),
    );

    expect([...new Set(importers)].filter((specifier) => shut.has(specifier))).toEqual([]);
  });
});
