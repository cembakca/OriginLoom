#!/usr/bin/env node
/**
 * No secret's value may appear in anything the browser downloads.
 *
 * The platform declares which of its variables are secret, and startup refuses
 * to boot without the ones that matter. Neither of those says anything about the
 * *client bundle*: a secret reaches it the moment someone writes
 * `import.meta.env.SOMETHING` in a module an island imports, and the result is a
 * credential published to every visitor — silently, because the build succeeds
 * and the page works.
 *
 * So this reads the built assets and looks for the values themselves. Not the
 * names: a name in a bundle is usually harmless and often a false alarm, while a
 * value is the leak, whatever route it took to get there.
 *
 * Runs inside `origin-build`, after the client build and before anything ships.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Which variables count as secret, by name.
 *
 * A pattern rather than a list, and deliberately: a list would have to live in
 * the tooling package, which does not depend on the runtime — so it would be a
 * copy of the platform's declaration, and copies drift. The rule is that a
 * variable whose name ends this way is a credential; an app that breaks the
 * convention can add names through `ORIGINLOOM_EXTRA_SECRETS`.
 */
const SECRET_NAME = /(_SECRET|_TOKEN|_KEY|_PASSWORD|_CREDENTIALS|_DSN)$/;

/**
 * Below this length a "secret" is a placeholder, a `1`, or the word `secret` —
 * values that appear in a bundle by coincidence and would make this check the
 * kind nobody trusts. A real credential is longer than this.
 */
const MIN_SECRET_LENGTH = 12;

const CLIENT_ASSET = /\.(js|mjs|css|html|json|map)$/;

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const clientDir = join(root, "dist/client");

if (!existsSync(clientDir)) {
  console.error(`✗ ${clientDir} not found; run the client build first.`);
  process.exit(1);
}

const extra = (process.env.ORIGINLOOM_EXTRA_SECRETS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const secrets = Object.entries(process.env)
  .filter(([name]) => SECRET_NAME.test(name) || extra.includes(name))
  .map(([name, value]) => ({ name, value: value?.trim() ?? "" }))
  .filter(({ value }) => value.length >= MIN_SECRET_LENGTH);

const files = await clientFiles(clientDir);
const leaks = [];
for (const file of files) {
  const contents = await readFile(file, "utf8");
  for (const { name, value } of secrets) {
    if (contents.includes(value)) leaks.push({ name, file: file.slice(root.length + 1) });
  }
}

if (leaks.length > 0) {
  console.error("\n✗ Secret values found in the client bundle:\n");
  for (const { name, file } of leaks) console.error(`  ${name} → ${file}`);
  console.error(
    "\nThese ship to every visitor. Read the value on the server and pass only what the\n" +
      "page needs, or mark the variable public if it was never a secret.\n",
  );
  process.exit(1);
}

console.log(
  `[client-secrets] ${files.length} asset(s) checked against ${secrets.length} secret value(s)`,
);

async function clientFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await clientFiles(path)));
    else if (CLIENT_ASSET.test(entry.name)) found.push(path);
  }
  return found;
}
