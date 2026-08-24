import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Build configuration, read by Vite and Vitest and never bundled for a browser.
 * Everything else in this package can end up in an island's chunk.
 */
const BUILD_ONLY = new Set(["vite.ts"]);

describe("@originloom/shared stays runtime-neutral", () => {
  /**
   * The same boundary the root ESLint config enforces, asserted independently.
   *
   * The config already carries a blanket `no-restricted-imports: "off"` for
   * `packages/**`, and this package's rule only wins because it is declared
   * after it. Reordering those two blocks would switch the guard off and break
   * nothing — which is exactly the kind of silence this repo has been paying
   * for. A test cannot be turned off by being moved.
   */
  it("imports no Node built-in outside its build configuration", async () => {
    const offenders: string[] = [];
    for await (const entry of glob("**/*.{ts,tsx}", { cwd: src })) {
      if (BUILD_ONLY.has(entry)) continue;
      const source = await readFile(join(src, entry), "utf8");
      if (/\bfrom\s+["']node:/.test(source) || /\brequire\(["']node:/.test(source)) {
        offenders.push(entry);
      }
    }

    expect(offenders).toEqual([]);
  });
});
