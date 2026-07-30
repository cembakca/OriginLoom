import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/** The packages a release covers, in dependency order. */
export const PACKAGES = ["shared", "core", "react", "vanilla", "tooling"];

/** Matches `publishConfig.registry` in every package. */
export const DEFAULT_REGISTRY_PORT = 4873;

/**
 * One Verdaccio shape for both the throwaway rehearsal and the local registry a
 * team runs while trying the standalone flow.
 *
 * `@originloom/*` is served only from local storage — never proxied upstream —
 * so a package that happens to exist on npmjs can never stand in for ours.
 * Everything else proxies npmjs so an app can still install react, hono and the
 * rest through this registry.
 *
 * The audit middleware is on because the release rehearsal runs `pnpm audit`
 * against this registry: without an audit endpoint the client does not report a
 * clean tree, it fails outright.
 */
export function writeVerdaccioConfig({ root, storage = join(root, "storage") }) {
  mkdirSync(root, { recursive: true });
  const configPath = join(root, "verdaccio.yaml");
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
    cache: true
packages:
  "@originloom/*":
    access: $all
    publish: $all
    unpublish: $all
  "**":
    access: $all
    publish: $all
    proxy: npmjs
middlewares:
  audit:
    enabled: true
log: { type: stdout, format: pretty, level: warn }
`,
  );
  return configPath;
}

/**
 * The npm client refuses to publish without a token even when the registry
 * accepts anonymous writes. Verdaccio does not check its value.
 */
export function writeNpmrc(path, registry) {
  const { port } = new URL(registry);
  writeFileSync(
    path,
    `registry=${registry}\n@originloom:registry=${registry}\n//localhost:${port}/:_authToken=originloom-local\n`,
  );
  return path;
}

export async function waitForRegistry(registry, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${registry}/-/ping`);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Registry at ${registry} did not become ready`);
}

export function verdaccioBin() {
  return join(repoRoot, "node_modules/verdaccio/bin/verdaccio");
}
