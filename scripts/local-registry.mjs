#!/usr/bin/env node
/**
 * A local npm registry that stays up, so an app can be built the way a product
 * team will build it once the packages are published: outside this repo, with
 * `@originloom/*` installed rather than symlinked.
 *
 * This is the same shape as the private Nexus registry we are heading for — only
 * the URL and the credentials differ. See docs/releasing.md.
 *
 *   pnpm registry:local            # foreground; Ctrl-C stops it
 *   pnpm registry:local --port 4900
 *
 * Storage lives in .verdaccio/ and survives restarts, so what you publish stays
 * published until you delete that directory.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

import {
  DEFAULT_REGISTRY_PORT,
  repoRoot,
  verdaccioBin,
  waitForRegistry,
  writeVerdaccioConfig,
} from "./verdaccio-config.mjs";

const port = readPort(process.argv.slice(2));
const root = join(repoRoot, ".verdaccio");
const registry = `http://localhost:${port}`;
const configPath = writeVerdaccioConfig({ root });

const child = spawn("node", [verdaccioBin(), "--config", configPath, "--listen", String(port)], {
  stdio: ["ignore", "inherit", "inherit"],
});

const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));

await waitForRegistry(registry);

console.log(`
  local registry: ${registry}
  storage:        ${join(root, "storage")}

  publish the packages here:   pnpm registry:publish
  point an app at it:          echo "@originloom:registry=${registry}" > .npmrc

  Ctrl-C stops the registry; published packages stay in .verdaccio/storage.
`);

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
