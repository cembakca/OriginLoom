#!/usr/bin/env node
/**
 * Creates a real project with the previous published tooling, upgrades it to
 * the current fixed group, runs migration, then executes the generated CI gate.
 *
 * The registry must contain both versions. Local usage:
 *   pnpm registry:local
 *   pnpm registry:publish
 *   pnpm upgrade:verify
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compareVersions,
  parseVersion,
} from "../packages/origin-tooling/bin/upgrade/compatibility.mjs";
import { repoRoot, writeNpmrc } from "./verdaccio-config.mjs";

const options = parseArgs(process.argv.slice(2));
const currentVersion = JSON.parse(
  readFileSync(join(repoRoot, "packages/origin-tooling/package.json"), "utf8"),
).version;
const previousVersion = options.from ?? findPreviousVersion(options.registry, currentVersion);
const workDirectory = mkdtempSync(join(tmpdir(), "originloom-upgrade-verify-"));
const npmrcPath = writeNpmrc(join(workDirectory, ".npmrc"), options.registry);
const environment = {
  ...process.env,
  npm_config_userconfig: npmrcPath,
  NPM_CONFIG_USERCONFIG: npmrcPath,
};
let failed = false;

try {
  if (compareVersions(previousVersion, currentVersion) >= 0) {
    throw new Error(
      "Upgrade source " +
        previousVersion +
        " current " +
        currentVersion +
        " sürümünden eski değil.",
    );
  }

  step("create project with published @originloom/tooling@" + previousVersion);
  const parent = join(workDirectory, "apps");
  run(
    "pnpm",
    [
      "--package=@originloom/tooling@" + previousVersion,
      "dlx",
      "origin-create-app",
      "upgrade-web",
      "--title",
      "Upgrade Verify",
      "--target-dir",
      parent,
      "--registry",
      options.registry,
      "--version",
      previousVersion,
    ],
    { cwd: workDirectory, env: environment },
  );
  const appDirectory = join(parent, "upgrade-web");

  step("install and verify the N-1 baseline");
  run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: appDirectory, env: environment });
  assertFixedGroup(appDirectory, previousVersion);
  for (const script of ["typecheck", "lint", "build"]) {
    run("pnpm", ["run", script], { cwd: appDirectory, env: environment });
  }

  step("install current tooling and inspect the pending upgrade");
  run(
    "pnpm",
    ["add", "--save-dev", "@originloom/tooling@" + currentVersion, "--registry", options.registry],
    { cwd: appDirectory, env: environment },
  );
  const beforeDoctor = run(
    "pnpm",
    ["exec", "origin-doctor", "--json"],
    { cwd: appDirectory, env: environment },
    false,
  );
  if (beforeDoctor.status === 0) {
    throw new Error("Doctor pending migration/package drift'i raporlamadı.");
  }

  step("dry-run, apply and re-run the migration to prove idempotence");
  run("pnpm", ["exec", "origin-migrate"], { cwd: appDirectory, env: environment });
  run("pnpm", ["exec", "origin-migrate", "--apply"], {
    cwd: appDirectory,
    env: environment,
  });
  const secondPlan = run(
    "pnpm",
    ["exec", "origin-migrate"],
    { cwd: appDirectory, env: environment },
    false,
  );
  if (secondPlan.status !== 0 || !secondPlan.stdout.includes("Uygulanacak değişiklik yok")) {
    throw new Error("Migration ikinci çalıştırmada idempotent değil.");
  }

  step("install the migrated fixed group and run the full consumer gate");
  run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: appDirectory, env: environment });
  run("pnpm", ["run", "origin:doctor", "--strict"], {
    cwd: appDirectory,
    env: environment,
  });
  run("pnpm", ["run", "ci"], { cwd: appDirectory, env: environment });
  assertFixedGroup(appDirectory, currentVersion);

  step(
    "done — real " +
      previousVersion +
      " project migrated to " +
      currentVersion +
      " and passed pnpm ci",
  );
} catch (error) {
  failed = true;
  console.error("\n✗ upgrade verification failed: " + error.message);
} finally {
  if (options.keep) console.log("\nkept: " + workDirectory);
  else rmSync(workDirectory, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);

function findPreviousVersion(registry, current) {
  const result = run(
    "npm",
    ["view", "@originloom/tooling", "versions", "--json", "--registry", registry],
    { env: process.env },
    false,
  );
  if (result.status !== 0) {
    throw new Error("Registry sürüm listesi okunamadı: " + registry);
  }
  const versions = JSON.parse(result.stdout);
  const currentParsed = parseVersion(current);
  const candidates = (Array.isArray(versions) ? versions : [versions])
    .filter((version) => {
      const parsed = parseVersion(version);
      return (
        parsed &&
        currentParsed &&
        parsed.major === currentParsed.major &&
        compareVersions(version, current) < 0
      );
    })
    .sort(compareVersions);
  const previous = candidates.at(-1);
  if (!previous) {
    throw new Error(
      registry + " içinde " + current + " sürümünden önceki desteklenen tooling sürümü bulunamadı.",
    );
  }
  return previous;
}

function assertFixedGroup(appDirectory, expectedVersion) {
  const names = ["shared", "core", "react", "tooling"];
  for (const name of names) {
    const path = join(appDirectory, "node_modules/@originloom", name, "package.json");
    if (!existsSync(path)) throw new Error("@originloom/" + name + " kurulmadı.");
    const version = JSON.parse(readFileSync(path, "utf8")).version;
    if (version !== expectedVersion) {
      throw new Error(
        "@originloom/" + name + " " + version + "; " + expectedVersion + " bekleniyordu.",
      );
    }
  }
}

function parseArgs(argv) {
  const parsed = {
    from: undefined,
    keep: false,
    registry: process.env.ORIGINLOOM_REGISTRY_URL ?? "http://localhost:4873",
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--from") parsed.from = argv[++index];
    else if (arg === "--registry") parsed.registry = argv[++index];
    else if (arg === "--keep") parsed.keep = true;
    else throw new Error("Unknown option: " + arg);
  }
  new URL(parsed.registry);
  return parsed;
}

function step(message) {
  console.log("\n▸ " + message);
}

function run(command, args, options = {}, inherit = true) {
  const result = spawnSync(command, args, {
    stdio: inherit ? "inherit" : "pipe",
    encoding: inherit ? undefined : "utf8",
    ...options,
  });
  if (inherit && result.status !== 0) {
    throw new Error(
      command + " " + args.join(" ") + " exited with " + (result.status ?? result.signal),
    );
  }
  return result;
}
