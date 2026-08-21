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
 *   origin-create-app landing-web --port 3020      # Vite follows on 5020
 *   origin-create-app landing-web --registry http://localhost:4873
 *   origin-create-app payments-web --with-ops    # + compose, k8s, load test
 *   origin-create-app payments-web --package-manager npm
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { renderTemplates, VITE_PORT_OFFSET } from "./create-app/templates.mjs";
import { knownPluginFlags, resolveFlagToPluginId } from "./create-app/plugins/registry.mjs";
import {
  assertKnownPackageManager,
  installCommand,
  lockfileFor,
  runScriptCommand,
} from "./lib/package-manager.mjs";

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * A standalone app pins the platform range. Defaulting to this CLI's own version
 * keeps the two in step: the generator that shipped in 0.2.0 scaffolds ^0.2.0.
 */
const TOOLING_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;
const DEFAULT_VERSION_RANGE = "^" + TOOLING_VERSION;

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (options.workspace && !workspaceRoot) {
    fail("--workspace requires running inside an OriginLoom workspace (no pnpm-workspace.yaml).");
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
  // Each app owns a Vite port too, so two of them can run dev side by side.
  const vitePort = options.vitePort ?? port + VITE_PORT_OFFSET;
  const files = renderTemplates({
    name,
    title,
    port,
    metricsPort: port + 6000,
    vitePort,
    mode: options.workspace ? "workspace" : "standalone",
    version: options.version ?? DEFAULT_VERSION_RANGE,
    templateVersion: TOOLING_VERSION,
    plugins: options.plugins,
    withOps: options.withOps,
    packageManager: options.packageManager,
    ...(options.registry ? { registry: options.registry } : {}),
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

  report({ ...options, name, port, appDir: options.appDir, workspaceRoot });
}

function installHint(packageManager) {
  return installCommand(packageManager, { frozen: false });
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
  const pm = o.packageManager ?? "pnpm";
  console.log(`\n✓ ${o.appDir} created (standalone: ${!o.workspace}, packageManager: ${pm})\n`);
  warnIfStandaloneInsideWorkspace(o);
  if (o.workspace) {
    console.log("Next steps:\n");
    console.log("  pnpm install");
    console.log(`  pnpm --filter ${o.name} dev:mock\n`);
    console.log("`dev:mock` runs the app, Vite and the bundled mock gateway.");
    console.log("Use `dev` once GATEWAY_URL points at a gateway of your own.\n");
    console.log(`The app will serve on http://127.0.0.1:${o.port}.\n`);
    return;
  }
  console.log("Next steps:\n");
  console.log(`  cd ${o.appDir}`);
  console.log("  git init");
  console.log(`  ${installHint(pm)}        # needs access to the @originloom/* registry`);
  console.log(
    `  ${runScriptCommand(pm, "dev:mock")}       # app + Vite + the bundled mock gateway\n`,
  );
  console.log(`The app will serve on http://127.0.0.1:${o.port}.`);
  console.log(
    `Once GATEWAY_URL points at a gateway of your own, use \`${runScriptCommand(pm, "dev")}\`:`,
  );
  console.log("it runs the app and Vite and nothing else.\n");
  console.log(`Commit ${lockfileFor(pm)} after the first install.\n`);
  if (o.withOps) {
    console.log("Deployment assets are in k8s/, docker-compose*.yml and load-test/.");
    console.log("Read OPERATIONS.md first — image, hosts and secrets are placeholders.\n");
  }
}

/**
 * A standalone app installs @originloom/* from a registry. Generated inside the
 * workspace that develops those packages, that is almost always a slip: they are
 * unpublished there, so `pnpm install` cannot resolve them.
 */
function warnIfStandaloneInsideWorkspace({ workspace, workspaceRoot, appDir, name }) {
  if (workspace || !workspaceRoot) return;
  if (!resolve(appDir).startsWith(resolve(workspaceRoot))) return;

  console.warn(
    `! ${name} is a standalone app inside an OriginLoom workspace.\n` +
      `  Standalone apps resolve @originloom/* from a registry, and the packages in\n` +
      `  this repo are not published — pnpm install will fail here.\n` +
      `  For an app that links the local packages, regenerate with --workspace:\n\n` +
      `    rm -rf ${appDir}\n` +
      `    pnpm create-app ${name} --workspace\n`,
  );
}

/** Writes an .npmrc so the app resolves @originloom/* from a private registry. */
function assertValidRegistry(value) {
  try {
    new URL(value);
  } catch {
    fail(`Invalid --registry: ${value}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = { workspace: false, withOps: false, plugins: [], packageManager: "pnpm" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace") options.workspace = true;
    else if (arg === "--with-ops") options.withOps = true;
    else if (arg.startsWith("--with-")) {
      const pluginId = resolveFlagToPluginId(arg);
      if (!pluginId) {
        fail(`Unknown option: ${arg}. Known plugin flags: ${knownPluginFlags().join(", ")}`);
      }
      if (!options.plugins.includes(pluginId)) options.plugins.push(pluginId);
    } else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--vite-port") options.vitePort = Number(argv[++i]);
    else if (arg === "--registry") options.registry = assertValidRegistry(argv[++i]);
    else if (arg === "--title") options.title = argv[++i];
    else if (arg === "--target-dir") options.targetDir = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--package-manager") {
      options.packageManager = argv[++i];
      assertKnownPackageManager(options.packageManager);
    } else if (arg.startsWith("--")) fail(`Unknown option: ${arg}`);
    else if (options.name === undefined) options.name = arg;
    else fail(`Unexpected argument: ${arg}`);
  }
  for (const flag of ["port", "vitePort"]) {
    const value = options[flag];
    if (value !== undefined && (!Number.isInteger(value) || value < 1024)) {
      fail(`Invalid --${flag === "vitePort" ? "vite-port" : flag}: ${value}`);
    }
  }
  if (options.vitePort !== undefined && options.vitePort === options.port) {
    fail("--vite-port must differ from --port");
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
