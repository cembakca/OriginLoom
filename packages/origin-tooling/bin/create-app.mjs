#!/usr/bin/env node
/**
 * Scaffolds a new OriginLoom product application.
 *
 * Two modes:
 *   standalone (default) — a self-contained repo that depends on the published
 *     @originloom/* packages. This is what a separate squad/repo uses.
 *   --workspace          — an app inside this monorepo (apps/<name>), depending
 *     on the packages via workspace:*. For the platform team's pilot apps.
 *
 * The generated app is intentionally thin: cache, auth, middleware, SSR pipeline
 * and the metadata engine come from the packages. It owns a route table, the
 * OriginRuntime implementation and its own chrome.
 *
 * Usage:
 *   origin-create-app                              # interactive, standalone
 *   origin-create-app investment-web --title "Yatırım"
 *   origin-create-app investment-web --target-dir ~/projects
 *   origin-create-app investment-web --version "^1.2.0"
 *   origin-create-app knowledge-web --workspace    # inside this monorepo
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { format } from "prettier";

import { renderTemplates } from "./create-app/templates.mjs";

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let workspaceRoot = null;
  if (options.workspace) {
    workspaceRoot = findWorkspaceRoot(process.cwd());
    if (!workspaceRoot) {
      fail("--workspace requires running inside an OriginLoom workspace (no pnpm-workspace.yaml).");
    }
  }

  const prompt = await createPrompter(options);
  let name;
  let title;
  try {
    name = options.name ?? (await prompt("Project name (kebab-case, e.g. investment-web): "));
    assertValidName(name);

    const appDir = options.workspace
      ? join(workspaceRoot, "apps", name)
      : join(resolve(options.targetDir ?? process.cwd()), name);
    if (existsSync(appDir)) fail(`${appDir} already exists.`);
    options.appDir = appDir;

    const suggested = titleCase(name);
    title = options.title ?? (await prompt(`Display title [${suggested}]: `));
    if (!title) title = suggested;
  } finally {
    prompt.close();
  }

  const port = options.port ?? 3010;
  const files = renderTemplates({
    name,
    title,
    port,
    metricsPort: port + 6000,
    mode: options.workspace ? "workspace" : "standalone",
    version: options.version ?? "^0.1.0",
  });

  // Templates interpolate values of unknown length (the title above all), so their
  // hand-written line breaks cannot match Prettier for every input. Formatting on
  // the way out means the generated app always passes its own `format:check`.
  const prettierConfig = JSON.parse(files[".prettierrc.json"]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(options.appDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await formatted(relativePath, contents, prettierConfig), "utf8");
  }

  report({ ...options, name, port, appDir: options.appDir });
}

/**
 * Files Prettier has no parser for (Dockerfile, .env, .nvmrc, …) are written
 * verbatim. Any other failure is a broken template and must surface.
 */
async function formatted(relativePath, contents, config) {
  try {
    return await format(contents, { ...config, filepath: relativePath });
  } catch (error) {
    if (error?.name === "UndefinedParserError") return contents;
    throw new Error(`Template ${relativePath} could not be formatted: ${error?.message}`, {
      cause: error,
    });
  }
}

function report(o) {
  console.log(`\n✓ ${o.appDir} created (standalone: ${!o.workspace})\n`);
  if (o.workspace) {
    console.log("Next steps:\n");
    console.log("  pnpm install");
    console.log(`  pnpm --filter ${o.name} dev\n`);
    console.log(`The app will serve on http://127.0.0.1:${o.port}.\n`);
    return;
  }
  console.log("Next steps:\n");
  console.log(`  cd ${o.appDir}`);
  console.log("  git init");
  console.log("  pnpm install        # needs access to the @originloom/* registry");
  console.log("  pnpm dev\n");
  console.log(`The app will serve on http://127.0.0.1:${o.port}.`);
  console.log("Set GATEWAY_URL in .env.development to point at your gateway.\n");
}

function parseArgs(argv) {
  const options = { workspace: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace") options.workspace = true;
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--title") options.title = argv[++i];
    else if (arg === "--target-dir") options.targetDir = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg.startsWith("--")) fail(`Unknown option: ${arg}`);
    else if (options.name === undefined) options.name = arg;
    else fail(`Unexpected argument: ${arg}`);
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1024)) {
    fail(`Invalid --port: ${options.port}`);
  }
  return options;
}

/**
 * Prompts from a terminal, or consumes piped lines so the generator stays
 * scriptable. Answers supplied as flags are never prompted for.
 */
async function createPrompter(options) {
  if (options.name !== undefined && options.title !== undefined) {
    const noop = async () => "";
    noop.close = () => {};
    return noop;
  }
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (question) => (await rl.question(question)).trim();
    ask.close = () => rl.close();
    return ask;
  }
  const piped = (await readStdin()).split("\n");
  let index = 0;
  const ask = async (question) => {
    const answer = (piped[index++] ?? "").trim();
    process.stdout.write(`${question}${answer}\n`);
    return answer;
  };
  ask.close = () => {};
  return ask;
}

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolvePromise(data));
  });
}

function assertValidName(name) {
  if (!name) fail("Project name is required.");
  if (!NAME_PATTERN.test(name)) {
    fail(`Invalid project name: ${name}\nUse lowercase kebab-case, e.g. investment-web`);
  }
  if (name === "showroom") fail("showroom is the reference app; pick another name.");
}

function titleCase(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function findWorkspaceRoot(start) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

await main();
