#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  compareVersions,
  COMPATIBILITY,
  FIRST_TRACKED_TEMPLATE_VERSION,
  PROJECT_SCHEMA_VERSION,
  parseVersion,
  TOOLING_VERSION,
  versionFromRange,
} from "./upgrade/compatibility.mjs";
import { pendingMigrations } from "./upgrade/migrations.mjs";
import {
  declaredOriginloomPackages,
  findProjectRoot,
  PLATFORM_PACKAGES,
  readProject,
} from "./upgrade/project.mjs";

const options = parseArgs(process.argv.slice(2));
const root = findProjectRoot(options.cwd);
if (!root) {
  exitWithError(
    "OriginLoom projesi bulunamadı. package.json içindeki @originloom/* bağımlılıklarını kontrol edin.",
  );
}

let report;
try {
  report = inspect(readProject(root));
} catch (error) {
  exitWithError(error.message);
}

if (options.json) console.log(JSON.stringify(report, null, 2));
else render(report);

const errors = report.findings.filter(({ severity }) => severity === "error").length;
const warnings = report.findings.filter(({ severity }) => severity === "warning").length;
process.exit(errors > 0 || (options.strict && warnings > 0) ? 1 : 0);

export function inspect(project) {
  const findings = [];
  const add = (severity, code, message, fix) =>
    findings.push({ severity, code, message, ...(fix ? { fix } : {}) });
  const declared = declaredOriginloomPackages(project.pkg);
  const declaredByName = new Map(declared.map((entry) => [entry.name, entry.range]));

  for (const required of ["@originloom/shared", "@originloom/core", "@originloom/tooling"]) {
    if (!declaredByName.has(required)) {
      add("error", "package-missing", required + " package.json içinde bulunamadı.");
    }
  }
  const rendererPackage = "@originloom/" + project.renderer;
  if (project.renderer === "unknown") {
    add("error", "renderer-unknown", "React veya vanilla renderer paketi belirlenemedi.");
  } else if (!declaredByName.has(rendererPackage)) {
    add("error", "renderer-package-missing", rendererPackage + " package.json içinde bulunamadı.");
  }

  const standaloneRanges = declared
    .filter(
      ({ name, range }) =>
        PLATFORM_PACKAGES.includes(name.slice("@originloom/".length)) && range !== "workspace:*",
    )
    .map(({ range }) => range);
  if (new Set(standaloneRanges).size > 1) {
    add(
      "error",
      "package-range-drift",
      "@originloom/* paketleri aynı fixed-group aralığında değil: " +
        [...new Set(standaloneRanges)].join(", "),
      "Bütün @originloom/* paketlerini aynı sürüme yükseltin.",
    );
  }

  const declaredVersion = versionFromRange(standaloneRanges[0]);
  const installed = installedVersions(
    project.root,
    declared.map(({ name }) => name),
  );
  const installedValues = [...new Set(installed.map(({ version }) => version))];
  if (installedValues.length > 1) {
    add(
      "error",
      "installed-version-drift",
      "Kurulu @originloom/* paketleri aynı sürümde değil: " + installedValues.join(", "),
      "Lockfile'ı güncelleyip pnpm install çalıştırın.",
    );
  }
  if (
    standaloneRanges[0] &&
    installedValues[0] &&
    !satisfiesRange(standaloneRanges[0], installedValues[0])
  ) {
    add(
      "warning",
      "lockfile-stale",
      "package.json " +
        standaloneRanges[0] +
        ", node_modules " +
        installedValues[0] +
        " kullanıyor.",
      "pnpm install çalıştırıp pnpm-lock.yaml değişikliğini inceleyin.",
    );
  }

  if (!project.metadata) {
    add(
      "warning",
      "metadata-missing",
      "Bu proje upgrade metadata'sından önce üretilmiş.",
      "Önce origin-migrate ile planı görün, sonra origin-migrate --apply çalıştırın.",
    );
  } else {
    if (project.metadata.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      add(
        "error",
        "metadata-schema",
        "Metadata schema " +
          project.metadata.schemaVersion +
          "; bu tooling " +
          PROJECT_SCHEMA_VERSION +
          " bekliyor.",
      );
    }
    if (project.metadata.renderer !== project.renderer) {
      add("error", "renderer-drift", "Metadata renderer değeri package.json ile uyuşmuyor.");
    }
    if (
      project.metadata.templateVersion &&
      compareVersions(project.metadata.templateVersion, TOOLING_VERSION) > 0
    ) {
      add(
        "error",
        "tooling-too-old",
        "Template " +
          project.metadata.templateVersion +
          ", çalışan tooling " +
          TOOLING_VERSION +
          " sürümünden yeni.",
        "@originloom/tooling paketini proje template sürümüne yükseltin.",
      );
    }
  }

  const pending = pendingMigrations(project.metadata);
  if (pending.length > 0) {
    add(
      "warning",
      "migration-pending",
      "Bekleyen migration: " + pending.map(({ id }) => id).join(", "),
      "origin-migrate ile planı inceleyin.",
    );
  }
  if (project.mode === "standalone" && !existsSync(join(project.root, "pnpm-lock.yaml"))) {
    add(
      "warning",
      "lockfile-missing",
      "pnpm-lock.yaml bulunamadı.",
      "pnpm install çalıştırıp lockfile'ı commit'leyin.",
    );
  }
  if (!project.pkg.scripts?.["origin:doctor"] || !project.pkg.scripts?.["origin:migrate"]) {
    add(
      "warning",
      "upgrade-scripts-missing",
      "package.json upgrade script'lerini taşımıyor.",
      "origin-migrate --apply güvenli script'leri ekler.",
    );
  }
  if (!project.pkg.scripts?.ci?.includes("origin:doctor --strict")) {
    add(
      "warning",
      "upgrade-ci-missing",
      "CI zinciri origin:doctor --strict kapısını taşımıyor.",
      "Özelleştirilmiş CI script'inize doctor strict adımını pnpm install sonrasında ekleyin.",
    );
  }

  if (findings.length === 0) {
    add("ok", "healthy", "Template metadata, paket grubu ve migration durumu uyumlu.");
  }

  return {
    ok: !findings.some(({ severity }) => severity === "error"),
    root: project.root,
    renderer: project.renderer,
    mode: project.mode,
    toolingVersion: TOOLING_VERSION,
    templateVersion: project.metadata?.templateVersion ?? "pre-" + FIRST_TRACKED_TEMPLATE_VERSION,
    declaredPlatformVersion: declaredVersion,
    installedVersions: installed,
    compatibility: COMPATIBILITY,
    findings,
  };
}

function satisfiesRange(range, installedVersion) {
  const expected = parseVersion(range.replace(/^[~^=]/, ""));
  const installed = parseVersion(installedVersion);
  if (!expected || !installed) return false;
  if (!range.startsWith("^") && !range.startsWith("~")) {
    return compareVersions(expected.raw, installed.raw) === 0;
  }
  if (compareVersions(installed.raw, expected.raw) < 0) return false;
  if (range.startsWith("~")) {
    return installed.major === expected.major && installed.minor === expected.minor;
  }
  if (expected.major > 0) return installed.major === expected.major;
  return installed.major === 0 && installed.minor === expected.minor;
}

function installedVersions(rootDirectory, names) {
  const result = [];
  for (const name of names) {
    const path = join(rootDirectory, "node_modules", ...name.split("/"), "package.json");
    if (!existsSync(path)) continue;
    try {
      result.push({ name, version: JSON.parse(readFileSync(path, "utf8")).version });
    } catch {
      result.push({ name, version: "invalid" });
    }
  }
  return result;
}

function render(result) {
  console.log("OriginLoom doctor " + result.toolingVersion);
  console.log("Project: " + result.root);
  console.log(
    "Template: " +
      result.templateVersion +
      " · renderer: " +
      result.renderer +
      " · mode: " +
      result.mode +
      "\n",
  );
  for (const finding of result.findings) {
    const mark = finding.severity === "error" ? "✗" : finding.severity === "warning" ? "!" : "✓";
    console.log(mark + " [" + finding.code + "] " + finding.message);
    if (finding.fix) console.log("  → " + finding.fix);
  }
}

function parseArgs(argv) {
  const parsed = { cwd: process.cwd(), json: false, strict: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--cwd") parsed.cwd = argv[++index];
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--help") {
      console.log("Usage: origin-doctor [--cwd <project>] [--json] [--strict]");
      process.exit(0);
    } else exitWithError("Bilinmeyen seçenek: " + arg);
  }
  return parsed;
}

function exitWithError(message) {
  console.error("\n✗ " + message + "\n");
  process.exit(1);
}
