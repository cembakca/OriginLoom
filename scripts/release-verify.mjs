#!/usr/bin/env node
/**
 * Release rehearsal.
 *
 * Every other check in this repo runs against the workspace, where the packages
 * resolve to `src/` through `workspace:*`. None of that proves the published
 * artifacts work: the `dist` build, the `publishConfig.exports` map, the version
 * rewriting and the cross-package dependencies only meet for the first time
 * inside a real registry.
 *
 * So: publish all five packages to a throwaway Verdaccio, scaffold an app that
 * has never seen this workspace, install from that registry, and build and boot
 * it. Anything that only worked because of the workspace fails here.
 *
 *   node scripts/release-verify.mjs [--renderer react|vanilla] [--keep]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const PACKAGES = ["shared", "core", "react", "vanilla", "tooling"];

const options = parseArgs(process.argv.slice(2));
const workDir = mkdtempSync(join(tmpdir(), "originloom-release-"));
const registryPort = await freePort();
const registry = `http://localhost:${registryPort}`;

const npmrcPath = join(workDir, ".npmrc");
// The client refuses to publish without a token even when the registry allows
// anonymous writes, so give it one; Verdaccio does not check its value.
writeFileSync(
  npmrcPath,
  `registry=${registry}\n@originloom:registry=${registry}\n//localhost:${registryPort}/:_authToken=release-verify\n`,
);
const npmEnv = {
  ...process.env,
  npm_config_userconfig: npmrcPath,
  NPM_CONFIG_USERCONFIG: npmrcPath,
};

let verdaccio;
let failed = false;

try {
  step(`Verdaccio on ${registry}`);
  verdaccio = await startVerdaccio(registryPort, workDir);

  step("build packages");
  run("pnpm", ["run", "build:packages"], { cwd: repoRoot });

  step("publish to the local registry");
  for (const name of PACKAGES) {
    run("pnpm", ["publish", "--registry", registry, "--no-git-checks", "--tag", "rehearsal"], {
      cwd: join(repoRoot, `packages/origin-${name}`),
      env: npmEnv,
      stdio: ["ignore", "ignore", "inherit"],
    });
    console.log(`  published @originloom/${name}`);
  }

  step(`scaffold a ${options.renderer} app outside the workspace`);
  const appDir = join(workDir, "app", "verify-web");
  mkdirSync(join(workDir, "app"), { recursive: true });
  run(
    "node",
    [
      join(repoRoot, "packages/origin-tooling/bin/create-app.mjs"),
      "verify-web",
      "--title",
      "Verify",
      "--target-dir",
      join(workDir, "app"),
      ...(options.renderer === "vanilla" ? ["--vanilla"] : []),
    ],
    { cwd: workDir },
  );
  // A scratch app must never inherit this repo's pnpm workspace or lockfile.
  writeFileSync(
    join(appDir, ".npmrc"),
    `registry=${registry}\n@originloom:registry=${registry}\n//localhost:${registryPort}/:_authToken=release-verify\n`,
  );
  writeFileSync(join(appDir, "pnpm-workspace.yaml"), "packages: []\n");

  step("install from the registry");
  run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: appDir, env: npmEnv });
  assertInstalledFromRegistry(appDir, options.renderer);

  step("typecheck, build and smoke the installed app");
  run("pnpm", ["exec", "tsc", "--noEmit"], { cwd: appDir });
  run("pnpm", ["exec", "origin-build"], { cwd: appDir });
  run("pnpm", ["exec", "origin-smoke"], { cwd: appDir, env: smokeEnv(appDir) });

  step("done — the published packages install, build and serve");
} catch (error) {
  failed = true;
  console.error(`\n✗ release verification failed: ${error.message}`);
} finally {
  verdaccio?.kill("SIGTERM");
  if (options.keep) console.log(`\nkept: ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);

function parseArgs(argv) {
  const parsed = { renderer: "react", keep: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--renderer") parsed.renderer = argv[++i];
    else if (argv[i] === "--vanilla") parsed.renderer = "vanilla";
    else if (argv[i] === "--keep") parsed.keep = true;
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  if (!["react", "vanilla"].includes(parsed.renderer)) {
    throw new Error(`Unknown renderer: ${parsed.renderer}`);
  }
  return parsed;
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startVerdaccio(port, root) {
  const storage = join(root, "storage");
  const configPath = join(root, "verdaccio.yaml");
  // Anonymous publish, no upstream proxy for our scope: the rehearsal must not
  // silently fall back to a package that happens to exist on npmjs.
  writeFileSync(
    configPath,
    `storage: ${storage}
auth:
  htpasswd:
    file: ${join(root, "htpasswd")}
    max_users: -1
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  "@originloom/*":
    access: $all
    publish: $all
    unpublish: $all
  "**":
    access: $all
    publish: $all
    proxy: npmjs
log: { type: stdout, format: pretty, level: error }
`,
  );

  const child = spawn(
    "node",
    [
      join(repoRoot, "node_modules/verdaccio/bin/verdaccio"),
      "--config",
      configPath,
      "--listen",
      String(port),
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  child.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`verdaccio exited with ${code}`);
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/-/ping`);
      if (response.ok) return child;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  throw new Error("Verdaccio did not become ready");
}

/** The point of the rehearsal: nothing may resolve back to the workspace. */
function assertInstalledFromRegistry(appDir, renderer) {
  // An app installs the base, the core, its own renderer and the CLIs — not the
  // renderer it did not choose.
  for (const name of ["shared", "core", "tooling", renderer]) {
    const installed = join(appDir, "node_modules/@originloom", name, "package.json");
    if (!existsSync(installed)) throw new Error(`@originloom/${name} was not installed`);
  }
  const core = join(appDir, "node_modules/@originloom/core");
  if (existsSync(join(core, "src"))) {
    throw new Error(
      "@originloom/core shipped its sources — the published package should carry dist only",
    );
  }
  if (!existsSync(join(core, "dist/app.js"))) {
    throw new Error("@originloom/core is missing dist/app.js");
  }
}

function smokeEnv(appDir) {
  return {
    ...process.env,
    NODE_ENV: "production",
    APP_ENV: "production",
    SITE_URL: "http://127.0.0.1:3010",
    GATEWAY_URL: "http://127.0.0.1:4999",
    RELEASE_ID: "release-verify",
    AUTH_REFRESH_COORDINATION_SECRET: "0123456789abcdef0123456789abcdef",
    CACHE_BACKEND: "memory",
    CACHE_REQUIRED: "false",
    npm_config_registry: registry,
    PWD: appDir,
  };
}
