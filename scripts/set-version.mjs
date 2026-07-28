#!/usr/bin/env node
/**
 * Sets one version across the five `@originloom/*` packages.
 *
 * They are a fixed group — they depend on each other by exact version — so a
 * release moves all of them or none. `pnpm changeset:version` does this from
 * accumulated changesets; this is the manual door for when you just want to
 * publish 0.2.0 and move on.
 *
 *   pnpm version:set 0.2.0
 *   pnpm version:set patch|minor|major
 *   pnpm version:set 0.3.0 --dry-run
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGES, repoRoot } from "./verdaccio-config.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const input = args.find((arg) => !arg.startsWith("--"));

if (!input) {
  console.error(
    "Usage: pnpm version:set <version|patch|minor|major> [--dry-run]\n" +
      "       pnpm version:set 0.2.0",
  );
  process.exit(1);
}

const manifests = PACKAGES.map((name) => {
  const path = join(repoRoot, `packages/origin-${name}`, "package.json");
  return { name, path, pkg: JSON.parse(readFileSync(path, "utf8")) };
});

const current = assertSingleCurrentVersion(manifests);
const next = resolveVersion(current, input);

if (next === current) {
  console.error(`Already at ${current}; nothing to do.`);
  process.exit(1);
}

console.log(`${current} → ${next}\n`);
for (const { name, path, pkg } of manifests) {
  console.log(`  @originloom/${name}`);
  if (dryRun) continue;
  pkg.version = next;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

if (dryRun) {
  console.log("\n(dry run — nothing written)");
  process.exit(0);
}

console.log(`
  next:

    pnpm install --lockfile-only     # workspace links pick up the new version
    pnpm registry:publish            # publish to the local registry
    git commit -am "chore(release): ${next}"

  A consumer app updates with:

    pnpm update "@originloom/*" --latest
`);

/** The group only makes sense if it is actually in step. */
function assertSingleCurrentVersion(entries) {
  const versions = [...new Set(entries.map((entry) => entry.pkg.version))];
  if (versions.length > 1) {
    console.error(
      "The packages are out of step, which the fixed group forbids:\n" +
        entries.map((entry) => `  @originloom/${entry.name} ${entry.pkg.version}`).join("\n") +
        "\nSet them explicitly: pnpm version:set <version>",
    );
    if (!process.argv.includes("--force")) process.exit(1);
  }
  return versions[0];
}

function resolveVersion(current, requested) {
  if (["patch", "minor", "major"].includes(requested)) return bump(current, requested);
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(requested)) {
    console.error(`Not a version: ${requested} (expected 1.2.3, or patch|minor|major)`);
    process.exit(1);
  }
  return requested;
}

function bump(current, level) {
  const [major, minor, patch] = current.split("-")[0].split(".").map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
