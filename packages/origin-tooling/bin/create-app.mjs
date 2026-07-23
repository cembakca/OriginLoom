#!/usr/bin/env node
/**
 * Scaffolds a new OriginLoom product application under apps/<name>.
 *
 * The generated app is intentionally thin: cache, auth, middleware, SSR pipeline
 * and the metadata engine come from @originloom/core and @originloom/react. What
 * it owns is a route table, the OriginRuntime implementation and its own chrome.
 *
 * Usage:
 *   origin-create-app                 # interactive
 *   origin-create-app investment-web
 *   origin-create-app investment-web --port 3010 --title "Yatırım" --install
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { renderTemplates } from "./create-app/templates.mjs";

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (!workspaceRoot) {
    fail("Not inside an OriginLoom workspace (no pnpm-workspace.yaml found).");
  }

  const prompt = await createPrompter(options);

  let name;
  let title;
  try {
    name = options.name ?? (await prompt("Project name (kebab-case, e.g. investment-web): "));
    assertValidName(name);

    if (existsSync(join(workspaceRoot, "apps", name))) {
      fail(`apps/${name} already exists.`);
    }

    const suggested = titleCase(name);
    title = options.title ?? (await prompt(`Display title [${suggested}]: `));
    if (!title) title = suggested;
  } finally {
    prompt.close();
  }

  const appDir = join(workspaceRoot, "apps", name);
  const port = options.port ?? 3010;
  const metricsPort = port + 6000;

  const files = renderTemplates({ name, title, port, metricsPort });

  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(appDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }

  console.log(`\n✓ apps/${name} created (${Object.keys(files).length} files)\n`);

  if (options.install) {
    console.log("Installing workspace dependencies…\n");
    await run("pnpm", ["install"], workspaceRoot);
    console.log(`\nNext: pnpm --filter ${name} dev  →  http://127.0.0.1:${port}\n`);
  } else {
    console.log("Next steps:\n");
    console.log("  pnpm install");
    console.log(`  pnpm --filter ${name} dev`);
    console.log(`\nThe app will serve on http://127.0.0.1:${port}.\n`);
  }
}

function parseArgs(argv) {
  const options = { install: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--install") options.install = true;
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--title") options.title = argv[++i];
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

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

await main();
