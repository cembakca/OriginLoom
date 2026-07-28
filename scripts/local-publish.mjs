#!/usr/bin/env node
/**
 * Builds the packages and publishes them to the local registry started by
 * `pnpm registry:local`.
 *
 * A local registry is a scratch pad, so republishing the same version replaces
 * it instead of failing — that is what iterating on the platform looks like.
 * A real registry never allows this; there you bump the version instead.
 *
 *   pnpm registry:publish
 *   pnpm registry:publish --port 4900
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_REGISTRY_PORT, PACKAGES, repoRoot, writeNpmrc } from "./verdaccio-config.mjs";

const port = readPort(process.argv.slice(2));
const registry = `http://localhost:${port}`;

await assertRegistryIsUp();

const npmrcDir = mkdtempSync(join(tmpdir(), "originloom-publish-"));
const npmrc = writeNpmrc(join(npmrcDir, ".npmrc"), registry);
const env = { ...process.env, npm_config_userconfig: npmrc, NPM_CONFIG_USERCONFIG: npmrc };

try {
  run("pnpm", ["run", "build:packages"], { cwd: repoRoot });

  for (const name of PACKAGES) {
    const cwd = join(repoRoot, `packages/origin-${name}`);
    const { version } = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    if (await isPublished(`@originloom/${name}`, version)) {
      unpublish(`@originloom/${name}@${version}`, env);
      console.log(`  replacing @originloom/${name}@${version}`);
    }
    run("pnpm", ["publish", "--registry", registry, "--no-git-checks"], {
      cwd,
      env,
      stdio: ["ignore", "ignore", "inherit"],
    });
    console.log(`  published @originloom/${name}@${version}`);
  }

  console.log(`
  ${PACKAGES.length} packages are on ${registry}

  build an app against them, anywhere outside this repo:

    mkdir -p ~/projects && cd ~/projects
    echo "@originloom:registry=${registry}" > .npmrc
    pnpm --package=@originloom/tooling dlx origin-create-app yatirim-web \\
      --title "Yatırım" --registry ${registry}
    cd yatirim-web && pnpm install && pnpm dev

  --registry writes the app's own .npmrc: npm config is not inherited from
  parent directories, and the one above only covers the dlx call.
`);
} finally {
  rmSync(npmrcDir, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
  }
}

async function assertRegistryIsUp() {
  const response = await registryFetch("/-/ping");
  if (response?.ok) return;
  console.error(`No registry answering on ${registry}. Start one with: pnpm registry:local`);
  process.exit(1);
}

async function isPublished(name, version) {
  const response = await registryFetch(`/${encodeURIComponent(name)}`);
  if (!response?.ok) return false;
  const meta = await response.json();
  return Boolean(meta.versions?.[version]);
}

/**
 * Verdaccio drops idle keep-alive sockets, which surfaces as a one-off
 * ECONNRESET between two requests. Ask for a fresh connection and retry.
 */
async function registryFetch(path, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(`${registry}${path}`, { headers: { connection: "close" } });
    } catch {
      if (attempt === attempts) return null;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  return null;
}

function unpublish(spec, env) {
  spawnSync("npm", ["unpublish", spec, "--force", "--registry", registry], {
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function readPort(argv) {
  const index = argv.indexOf("--port");
  if (index === -1) return DEFAULT_REGISTRY_PORT;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1024) {
    console.error(`Invalid --port: ${argv[index + 1]}`);
    process.exit(1);
  }
  return value;
}
