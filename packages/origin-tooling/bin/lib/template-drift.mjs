import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { format } from "prettier";

import { renderTemplates } from "../create-app/templates.mjs";

/**
 * How far an app has moved from the template it was generated from.
 *
 * A generated app is a copy, and the failure mode of a copy is silence: the
 * template grows a fix, the app never gets it, and nothing fails — because a
 * missing improvement fails nothing. Twice now that silence hid something real
 * (a lint rule an app never had; a BFF helper an app never gained). Both were
 * found by diffing by hand, which is exactly the step that will not happen
 * across fifteen apps.
 *
 * This is that diff, as a command. It does not judge: most divergence in a
 * healthy app is the product itself — its routes, its pages, its cache keys.
 * What it gives you is the ranked list, so an infrastructure file sitting near
 * the top is visible instead of merely true.
 */

/**
 * Files whose generated content embeds the display title chosen at scaffold
 * time. Projects created before the scaffold block was recorded cannot
 * reproduce it, so these are reported as uncompared rather than as drift.
 */
const TITLE_DEPENDENT = [
  "README.md",
  "server/product/document-shell.ts",
  "server/routes/home.tsx",
  "src/assets/images/hero.svg",
  "src/assets/images/og-cover.svg",
  "src/components/layout/root-layout.tsx",
  "src/lib/metadata/site-defaults.ts",
];

/** Reads PORT / METRICS_PORT out of the app's own development env. */
function envPorts(root) {
  const path = join(root, ".env.development");
  if (!existsSync(path)) return {};
  const source = readFileSync(path, "utf8");
  const read = (key) => {
    const match = new RegExp(`^${key}=(\\d+)`, "m").exec(source);
    return match ? Number(match[1]) : undefined;
  };
  return { port: read("PORT"), metricsPort: read("METRICS_PORT") };
}

/**
 * The scaffold parameters, from the project metadata when it has them and from
 * the app itself when it does not. `title` is the one value nothing else in the
 * app records unambiguously, so it stays undefined rather than guessed.
 */
export function scaffoldParameters(project) {
  const recorded = project.metadata?.scaffold ?? {};
  const ports = envPorts(project.root);
  return {
    name: recorded.name ?? project.pkg?.name ?? "app",
    title: recorded.title,
    port: recorded.port ?? ports.port ?? 3000,
    metricsPort: recorded.metricsPort ?? ports.metricsPort ?? 9000,
    ...(recorded.vitePort ? { vitePort: recorded.vitePort } : {}),
    mode: project.metadata?.mode ?? "standalone",
    version: project.metadata?.platformRange ?? "latest",
    packageManager: project.metadata?.packageManager ?? "pnpm",
    plugins: project.metadata?.plugins ?? [],
  };
}

/**
 * The template as this app would be generated today, formatted the way
 * `create-app` writes it — otherwise every file comes back as drift because
 * Prettier reflowed it on the way to disk.
 */
async function renderBaseline(parameters) {
  const files = renderTemplates({ ...parameters, title: parameters.title ?? parameters.name });
  const config = JSON.parse(files[".prettierrc.json"]);
  const baseline = new Map();
  for (const [path, contents] of Object.entries(files)) {
    let formatted = contents;
    try {
      formatted = await format(contents, { ...config, filepath: path });
    } catch {
      // Not every template file is something Prettier parses (svg, Dockerfile);
      // those are compared as written.
    }
    baseline.set(path, formatted);
  }
  return baseline;
}

/** Lines that differ between two versions of a file, counted the way `diff -u` does. */
function differingLines(left, right) {
  const a = left.split("\n");
  const b = right.split("\n");
  // Longest common subsequence over lines; the files being compared are one
  // app's source, so the quadratic table is small enough to not matter.
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return a.length + b.length - 2 * table[0][0];
}

/**
 * @returns {Promise<{ parameters: object, files: Array<{path: string, lines: number}>,
 *   missing: string[], uncompared: string[], total: number }>}
 */
export async function measureDrift(project) {
  const parameters = scaffoldParameters(project);
  const baseline = await renderBaseline(parameters);
  const skip = parameters.title ? new Set() : new Set(TITLE_DEPENDENT);

  const files = [];
  const missing = [];
  const uncompared = [];
  for (const [path, expected] of baseline) {
    const target = join(project.root, path);
    if (!existsSync(target)) {
      missing.push(path);
      continue;
    }
    if (skip.has(path)) {
      uncompared.push(path);
      continue;
    }
    const lines = differingLines(expected, readFileSync(target, "utf8"));
    if (lines > 0) files.push({ path, lines });
  }
  files.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));
  return {
    parameters,
    files,
    missing: missing.sort(),
    uncompared: uncompared.sort(),
    total: files.reduce((sum, { lines }) => sum + lines, 0),
  };
}
