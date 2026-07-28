import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The core renders through the `OriginRenderer` seam, so a UI framework must
 * never reach it — not as a dependency, not as a JSX file, not even as a type
 * import. `origin-check-cycles` enforces the same rule on every commit; these
 * assertions make the intent visible where the package lives.
 */
const packageRoot = join(import.meta.dirname, "..");
const sourceRoot = join(packageRoot, "src");

const FRAMEWORK_PACKAGES = /^(react|react-dom|preact|@originloom\/react)$/;
const FRAMEWORK_IMPORT = /from\s+["'](react|react-dom|preact|@originloom\/react)(\/[^"']*)?["']/;

function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("@originloom/core is framework-free", () => {
  it("declares no UI framework in any dependency field", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const declared = ["dependencies", "devDependencies", "peerDependencies"].flatMap((field) =>
      Object.keys(pkg[field] ?? {}),
    );
    expect(declared.filter((name) => FRAMEWORK_PACKAGES.test(name))).toEqual([]);
  });

  it("ships no .tsx file", () => {
    expect(collectSources(sourceRoot).filter((file) => file.endsWith(".tsx"))).toEqual([]);
  });

  it("imports no UI framework module", () => {
    const offenders = collectSources(sourceRoot).filter((file) =>
      FRAMEWORK_IMPORT.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
