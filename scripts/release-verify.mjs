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
 * it. The React rehearsal also drives the production bundle through Chromium.
 * Anything that only worked because of the workspace fails here.
 *
 *   node scripts/release-verify.mjs [--renderer react|vanilla] [--keep]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PACKAGES,
  repoRoot,
  verdaccioBin,
  waitForRegistry,
  writeNpmrc,
  writeVerdaccioConfig,
} from "./verdaccio-config.mjs";

const options = parseArgs(process.argv.slice(2));
const workDir = mkdtempSync(join(tmpdir(), "originloom-release-"));
const registryPort = await freePort();
const appPort = await freePortInRange(10_000, 50_000);
const mockGatewayPort = await freePortInRange(10_000, 50_000);
const registry = `http://localhost:${registryPort}`;

const npmrcPath = writeNpmrc(join(workDir, ".npmrc"), registry);
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
      "--port",
      String(appPort),
      ...(options.renderer === "vanilla" ? ["--vanilla"] : []),
    ],
    { cwd: workDir },
  );
  // A scratch app must never inherit this repo's pnpm workspace or lockfile.
  writeNpmrc(join(appDir, ".npmrc"), registry);
  writeFileSync(join(appDir, "pnpm-workspace.yaml"), "packages: []\n");

  step("install from the registry");
  run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: appDir, env: npmEnv });
  assertInstalledFromRegistry(appDir, options.renderer);
  assertNoUnsupportedUuid(appDir);
  run("pnpm", ["audit", "--audit-level", "low"], { cwd: appDir, env: npmEnv });

  step("doctor, static checks, tests, build and smoke the installed app");
  run("pnpm", ["exec", "origin-doctor", "--strict"], { cwd: appDir });
  run("pnpm", ["exec", "tsc", "--noEmit"], { cwd: appDir });
  run("pnpm", ["run", "check:cycles"], { cwd: appDir });
  run("pnpm", ["run", "lint"], { cwd: appDir });
  run("pnpm", ["run", "format:check"], { cwd: appDir });
  run("pnpm", ["run", "test"], { cwd: appDir });
  if (options.renderer === "react") run("pnpm", ["run", "contracts:fixtures"], { cwd: appDir });
  run("pnpm", ["exec", "origin-build"], { cwd: appDir });
  if (options.renderer === "react") run("pnpm", ["run", "budget:bundle"], { cwd: appDir });
  run("pnpm", ["exec", "origin-smoke"], { cwd: appDir, env: smokeEnv(appDir) });
  if (options.renderer === "react") {
    step("exercise the installed load generator against the production bundle");
    run(
      "pnpm",
      [
        "run",
        "capacity:quick",
        "--",
        "--only",
        "home",
        "--connections",
        "5",
        "--duration",
        "1",
        "--repeats",
        "1",
        "--warmup",
        "0",
        "--no-build",
      ],
      { cwd: appDir, env: npmEnv },
    );
  }

  if (options.renderer === "react") {
    step("install Chromium and exercise the published app in a real browser");
    run("pnpm", ["exec", "playwright", "install", ...browserInstallArgs(), "chromium"], {
      cwd: appDir,
      env: npmEnv,
    });
    // Never attach to a server left behind by another local test or project.
    // CI mode disables Playwright's reuseExistingServer path; the generated app
    // also receives a free port above, so this run owns everything it exercises.
    run("pnpm", ["exec", "playwright", "test"], {
      cwd: appDir,
      env: { ...npmEnv, CI: "true", E2E_MOCK_GATEWAY_PORT: String(mockGatewayPort) },
    });
    run("pnpm", ["run", "lighthouse"], { cwd: appDir, env: npmEnv });
  }

  step("done — the published packages install, build, serve and pass their release checks");
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

async function freePortInRange(min, max) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const port = Math.floor(Math.random() * (max - min + 1)) + min;
    const available = await new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`Could not find a free app port between ${min} and ${max}`);
}

async function startVerdaccio(port, root) {
  const configPath = writeVerdaccioConfig({ root });
  const child = spawn("node", [verdaccioBin(), "--config", configPath, "--listen", String(port)], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`verdaccio exited with ${code}`);
  });

  try {
    await waitForRegistry(`http://localhost:${port}`);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return child;
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

function assertNoUnsupportedUuid(appDir) {
  const lockfile = readFileSync(join(appDir, "pnpm-lock.yaml"), "utf8");
  const unsupported = [...lockfile.matchAll(/^\s{2}uuid@(\d+)\.[^:]+:/gm)]
    .map((match) => Number(match[1]))
    .filter((major) => major <= 10);
  if (unsupported.length) {
    throw new Error(`unsupported uuid major(s) installed: ${[...new Set(unsupported)].join(", ")}`);
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

function browserInstallArgs() {
  return process.platform === "linux" ? ["--with-deps"] : [];
}
