#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { format, resolveConfig } from "prettier";

import {
  compareVersions,
  MIN_AUTOMATIC_MIGRATION_VERSION,
  PROJECT_FILE,
  PROJECT_SCHEMA_VERSION,
  supportsAutomaticMigration,
  TOOLING_VERSION,
  UPGRADE_CONTRACT_MIGRATION,
} from "./upgrade/compatibility.mjs";
import { pendingMigrations } from "./upgrade/migrations.mjs";
import { declaredOriginloomPackages, findProjectRoot, readProject } from "./upgrade/project.mjs";

const options = parseArgs(process.argv.slice(2));
const root = findProjectRoot(options.cwd);
if (!root) fail("OriginLoom projesi bulunamadı.");

let project;
try {
  project = readProject(root);
} catch (error) {
  fail(error.message);
}

const inferredVersion = inferTemplateVersion(project);
if (!supportsAutomaticMigration(inferredVersion)) {
  fail(
    (inferredVersion ?? "bilinmeyen") +
      " sürümünden otomatik migration desteklenmiyor. Desteklenen en eski sürüm " +
      MIN_AUTOMATIC_MIGRATION_VERSION +
      "; docs/upgrading.md içindeki manuel yolu izleyin.",
  );
}
if (compareVersions(inferredVersion, TOOLING_VERSION) > 0) {
  fail(
    "Proje " +
      inferredVersion +
      ", çalışan tooling " +
      TOOLING_VERSION +
      "; önce tooling'i yükseltin.",
  );
}

const pending = pendingMigrations(project.metadata);
const plan = buildPlan(project, inferredVersion, pending);
if (options.json) console.log(JSON.stringify(publicPlan(plan), null, 2));
else renderPlan(plan, options.apply);

if (!options.apply || plan.changes.length === 0) process.exit(0);
if (!options.allowDirty && isDirtyGitRepo(root)) {
  fail(
    "Git çalışma ağacı temiz değil. Değişiklikleri commit/stash edin veya bilinçli olarak --allow-dirty kullanın.",
  );
}

await applyPlan(project, plan);
console.log("\n✓ Migration tamamlandı. Backup: " + plan.backupDirectory);
console.log("  Sonraki adımlar: pnpm install && pnpm origin:doctor --strict && pnpm ci\n");

function buildPlan(current, fromVersion, migrations) {
  const changes = [];
  const fileWrites = {};
  const nextPackage = structuredClone(current.pkg);
  for (const migration of migrations) {
    migration.migratePackage?.(nextPackage, changes);
    migration.migrateProject?.(current.root, changes, fileWrites);
  }
  nextPackage.scripts ??= {};
  if (nextPackage.scripts["origin:doctor"] !== "origin-doctor") {
    nextPackage.scripts["origin:doctor"] = "origin-doctor";
    changes.push({
      file: "package.json",
      kind: "script",
      detail: "origin:doctor → origin-doctor",
    });
  }
  if (nextPackage.scripts["origin:migrate"] !== "origin-migrate") {
    nextPackage.scripts["origin:migrate"] = "origin-migrate";
    changes.push({
      file: "package.json",
      kind: "script",
      detail: "origin:migrate → origin-migrate",
    });
  }
  const ciScript = nextPackage.scripts.ci;
  if (
    typeof ciScript === "string" &&
    ciScript.startsWith("pnpm run typecheck") &&
    !ciScript.includes("origin:doctor")
  ) {
    nextPackage.scripts.ci = "pnpm run origin:doctor --strict && " + ciScript;
    changes.push({
      file: "package.json",
      kind: "script",
      detail: "Bilinen generated CI zincirine origin:doctor --strict kapısı eklenir.",
    });
  }

  if (current.mode === "standalone") {
    for (const { name } of declaredOriginloomPackages(nextPackage)) {
      const section = Object.hasOwn(nextPackage.dependencies ?? {}, name)
        ? nextPackage.dependencies
        : nextPackage.devDependencies;
      const expected = "^" + TOOLING_VERSION;
      if (section[name] !== expected) {
        changes.push({
          file: "package.json",
          kind: "dependency",
          detail: name + ": " + section[name] + " → " + expected,
        });
        section[name] = expected;
      }
    }
  }

  const appliedMigrations = new Set(current.metadata?.appliedMigrations ?? []);
  for (const migration of migrations) appliedMigrations.add(migration.id);
  appliedMigrations.add(UPGRADE_CONTRACT_MIGRATION);
  const nextMetadata = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    templateVersion: TOOLING_VERSION,
    platformRange: current.mode === "workspace" ? "workspace:*" : "^" + TOOLING_VERSION,
    renderer: current.renderer,
    mode: current.mode,
    generatedBy: "@originloom/tooling",
    plugins: inferPlugins(current),
    appliedMigrations: [...appliedMigrations].sort(),
  };
  if (JSON.stringify(current.metadata) !== JSON.stringify(nextMetadata)) {
    changes.push({
      file: PROJECT_FILE,
      kind: "metadata",
      detail: fromVersion + " → " + TOOLING_VERSION,
    });
  }

  const guidePath = join(current.root, "docs/upgrading.md");
  if (!existsSync(guidePath)) {
    changes.push({
      file: "docs/upgrading.md",
      kind: "add",
      detail: "Upgrade runbook eklenir; mevcut dosya asla ezilmez.",
    });
  }

  return {
    fromVersion,
    toVersion: TOOLING_VERSION,
    migrations: migrations.map(({ id, description }) => ({ id, description })),
    changes,
    fileWrites,
    nextPackage,
    nextMetadata,
    backupDirectory: join(
      current.root,
      ".originloom",
      "backups",
      fromVersion + "-to-" + TOOLING_VERSION,
    ),
  };
}

async function applyPlan(current, plan) {
  mkdirSync(plan.backupDirectory, { recursive: true });
  backupIfPresent(current.packagePath, join(plan.backupDirectory, "package.json"));
  backupIfPresent(current.metadataPath, join(plan.backupDirectory, "project.json"));
  await writeJsonAtomic(current.packagePath, plan.nextPackage);
  await writeJsonAtomic(current.metadataPath, plan.nextMetadata);

  for (const [relativePath, contents] of Object.entries(plan.fileWrites ?? {})) {
    const target = join(current.root, relativePath);
    backupIfPresent(target, join(plan.backupDirectory, relativePath));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }

  const targetGuide = join(current.root, "docs/upgrading.md");
  if (!existsSync(targetGuide)) {
    mkdirSync(dirname(targetGuide), { recursive: true });
    const source = new URL("./create-app/assets/docs/upgrading.md", import.meta.url);
    copyFileSync(source, targetGuide);
  }
}

function inferTemplateVersion(current) {
  if (current.metadata?.templateVersion) return current.metadata.templateVersion;
  const versions = declaredOriginloomPackages(current.pkg)
    .map(({ range }) => range.replace(/^[~^=]/, ""))
    .filter((version) => /^\d+\.\d+\.\d+/.test(version));
  return versions[0] ?? null;
}

function inferPlugins(current) {
  if (Array.isArray(current.metadata?.plugins)) {
    return [...current.metadata.plugins].sort();
  }
  const scripts = current.pkg.scripts ?? {};
  if (typeof scripts["compose:up"] === "string") return ["with-ops"];
  return [];
}

function backupIfPresent(source, target) {
  if (!existsSync(source)) return;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

async function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + ".originloom-tmp-" + process.pid;
  const config = (await resolveConfig(path)) ?? {};
  const contents = await format(JSON.stringify(value), {
    ...config,
    filepath: path,
  });
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, path);
}

function isDirtyGitRepo(cwd) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "ignore" });
    return (
      execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0
    );
  } catch {
    return false;
  }
}

function publicPlan(plan) {
  return {
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    migrations: plan.migrations,
    changes: plan.changes,
    backupDirectory: plan.backupDirectory,
  };
}

function renderPlan(plan, applying) {
  console.log("OriginLoom migration planı: " + plan.fromVersion + " → " + plan.toVersion);
  if (plan.changes.length === 0) {
    console.log("✓ Uygulanacak değişiklik yok.");
    return;
  }
  for (const change of plan.changes) {
    console.log("- " + change.file + ": " + change.detail);
  }
  if (!applying) {
    console.log("\nDry-run: değişiklik yazılmadı. Uygulamak için origin-migrate --apply kullanın.");
  }
}

function parseArgs(argv) {
  const parsed = { cwd: process.cwd(), apply: false, allowDirty: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--cwd") parsed.cwd = argv[++index];
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--allow-dirty") parsed.allowDirty = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--help") {
      console.log("Usage: origin-migrate [--cwd <project>] [--apply] [--allow-dirty] [--json]");
      process.exit(0);
    } else fail("Bilinmeyen seçenek: " + arg);
  }
  return parsed;
}

function fail(message) {
  console.error("\n✗ " + message + "\n");
  process.exit(1);
}
