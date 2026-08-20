import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const generateIcons = join(dirname(fileURLToPath(import.meta.url)), "../bin/generate-icons.mjs");

const svgrConfig = `module.exports = {
  typescript: true,
  icon: true,
  jsxRuntime: "automatic",
  expandProps: "end",
  memo: false,
  prettier: false,
  svgoConfig: {
    plugins: [
      { name: "preset-default", params: { overrides: { removeViewBox: false } } },
      { name: "convertStyleToAttrs" },
      { name: "convertColors", params: { currentColor: true } },
    ],
  },
};
`;

describe("generate-icons", () => {
  it("converts hardcoded stroke and fill hex colors to currentColor", async () => {
    const root = await mkdtemp(join(tmpdir(), "originloom-icons-"));
    const svgDir = join(root, "src/assets/svg");
    await mkdir(svgDir, { recursive: true });
    await writeFile(join(root, ".svgrrc.cjs"), svgrConfig);
    await writeFile(
      join(svgDir, "accent-stroke.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <path d="M12 5v14M5 12h14" stroke="#D44F0D" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,
    );
    await writeFile(
      join(svgDir, "accent-fill.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="8" fill="#0f172a"/>
</svg>`,
    );
    await writeFile(
      join(svgDir, "styled-stroke.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <path style="stroke:#D44F0D;stroke-width:2" d="M5 12h14"/>
</svg>`,
    );

    execFileSync(process.execPath, [generateIcons], {
      cwd: root,
      env: { ...process.env, ORIGIN_APP_ROOT: root },
      stdio: "pipe",
    });

    const outDir = join(root, "src/components/icons");
    const strokeIcon = await readFile(join(outDir, "accent-stroke.tsx"), "utf8");
    const fillIcon = await readFile(join(outDir, "accent-fill.tsx"), "utf8");
    const styledIcon = await readFile(join(outDir, "styled-stroke.tsx"), "utf8");
    const index = await readFile(join(outDir, "index.ts"), "utf8");

    expect(strokeIcon).toContain("currentColor");
    expect(strokeIcon).not.toMatch(/#D44F0D/i);
    expect(strokeIcon).toContain("strokeWidth={2.5}");

    expect(fillIcon).toContain("currentColor");
    expect(fillIcon).not.toMatch(/#0f172a/i);

    expect(styledIcon).toContain("currentColor");
    expect(styledIcon).not.toMatch(/#D44F0D/i);

    expect(index).toContain("AccentStroke");
    expect(index).toContain("StyledStroke");
  });
});
