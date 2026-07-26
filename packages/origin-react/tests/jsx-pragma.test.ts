import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The dev runner (`tsx`) resolves a single tsconfig from the app it starts, so the
 * app's `jsx: react-jsx` setting never reaches package sources. Without an explicit
 * pragma these files fall back to the classic runtime and throw
 * "React is not defined" at render time — in dev only, which is easy to miss.
 */
const PRAGMA = "@jsxRuntime automatic";

function collectTsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTsxFiles(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("workspace package JSX", () => {
  it("every origin-react .tsx file declares the automatic JSX runtime", () => {
    const missing = collectTsxFiles(join(import.meta.dirname, "../src")).filter(
      (file) => !readFileSync(file, "utf8").includes(PRAGMA),
    );
    expect(missing).toEqual([]);
  });

  it.each([
    ["origin-core", join(import.meta.dirname, "../../origin-core/src")],
    ["origin-shared", join(import.meta.dirname, "../../origin-shared/src")],
  ])("%s contains no JSX at all", (_name, root) => {
    expect(collectTsxFiles(root)).toEqual([]);
  });
});
