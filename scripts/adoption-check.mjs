#!/usr/bin/env node
/**
 * Exports nobody calls.
 *
 * Three times this turn a review found the same thing: a primitive that was
 * well designed, well tested, and had **zero callers** — `parseEnv`, `publicEnv`,
 * `taintObject`. Each looked finished from the inside. A test suite is not a
 * caller; it proves the thing works, never that anything uses it.
 *
 * `origin-doctor --drift` cannot see this class. Drift measures how far an app
 * has moved from the template, and an API nobody calls has not moved at all.
 *
 * These are libraries, so "no caller inside the package" is normal — a consumer
 * calls it. That is why the search covers every consumer this repo has: the
 * other packages, the showroom, and the code `create-app` generates. An export
 * none of those three reaches has no reader at all.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packages = ["origin-shared", "origin-core", "origin-react"];

/**
 * Names that are allowed to have no reader yet, each with the reason.
 *
 * Kept short on purpose: an allowlist that grows to match whatever is unused
 * turns this check off one line at a time.
 */
const ALLOWED = new Map([
  ["clearTaintRegistryForTests", "test-only by name and by contract"],
  ["trustedRichText", "escape hatch for platform-generated HTML; no caller is the good state"],
]);

const exported = new Map();
for (const pkg of packages) {
  const dir = join(root, "packages", pkg, "src");
  for (const file of await sourceFiles(dir)) {
    const contents = await readFile(file, "utf8");
    for (const name of exportedNames(contents)) {
      if (!exported.has(name)) exported.set(name, relative(root, file));
    }
  }
}

const consumers = [
  ...(await Promise.all(packages.map((pkg) => sourceFiles(join(root, "packages", pkg, "src"))))),
  await sourceFiles(join(root, "apps/showroom/server")),
  await sourceFiles(join(root, "apps/showroom/src")),
  // The real product, when it is checked out here. It is the consumer whose
  // opinion counts most: an export sigorta reaches has a reader even if the
  // reference app never got round to it.
  await sourceFiles(join(root, "OriginLoomSigorta/server")),
  await sourceFiles(join(root, "OriginLoomSigorta/src")),
].flat();

const seen = new Set();
for (const file of consumers) {
  const contents = await readFile(file, "utf8");
  const owner = relative(root, file);
  for (const [name, declaredIn] of exported) {
    // A file cannot adopt its own export; that is where it was declared.
    if (owner === declaredIn) continue;
    if (new RegExp(`\\b${name}\\b`).test(contents)) seen.add(name);
  }
}

// The generated app is the third consumer, and the one a product actually gets.
const { renderTemplates } = await import(
  join(root, "packages/origin-tooling/bin/create-app/templates.mjs")
);
const generated = Object.values(
  renderTemplates({
    name: "adoption",
    title: "Adoption",
    port: 3000,
    metricsPort: 9000,
    mode: "standalone",
    version: "latest",
  }),
).join("\n");
for (const name of exported.keys()) {
  if (new RegExp(`\\b${name}\\b`).test(generated)) seen.add(name);
}

const orphans = [...exported]
  .filter(([name]) => !seen.has(name) && !ALLOWED.has(name))
  .sort(([a], [b]) => a.localeCompare(b));

console.log(`${exported.size} export, ${seen.size} tanesinin çağıranı var`);
if (orphans.length === 0) {
  console.log("✓ okuru olmayan export yok");
  process.exit(0);
}

console.log(`\n${orphans.length} export'un hiçbir okuru yok:\n`);
for (const [name, file] of orphans) console.log(`  ${name.padEnd(38)} ${file}`);
console.log(
  "\nHer biri ya bir çağıran hak ediyor (showroom'da ya da şablonda), ya silinmeyi,\n" +
    "ya da ALLOWED listesine gerekçesiyle bir satır.\n",
);

/**
 * Reports, does not fail — for now, and for a stated reason.
 *
 * The list is long because it is the first time anyone looked, and a gate that
 * fails on seventy-eight things on day one is a gate someone deletes on day two.
 * It becomes `--strict`-able the moment the list is empty; until then the number
 * itself is the useful signal, and it should only ever go down.
 */
process.exit(process.argv.includes("--strict") ? 1 : 0);

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/** Value exports only: a type nobody names costs nothing at runtime. */
function exportedNames(contents) {
  const names = [];
  const pattern = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of contents.matchAll(pattern)) names.push(match[1]);
  return names;
}
