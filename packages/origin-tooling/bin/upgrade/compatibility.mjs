import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_FILE = ".originloom/project.json";
export const FIRST_TRACKED_TEMPLATE_VERSION = "0.5.14";
export const MIN_AUTOMATIC_MIGRATION_VERSION = "0.5.12";
export const UPGRADE_CONTRACT_MIGRATION = "0.5.14-upgrade-contract-v1";

export const TOOLING_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
).version;

export const COMPATIBILITY = [
  {
    template: "0.6.x",
    platform: "0.6.x",
    tooling: "0.6.x",
    node: ">=22.19.0",
    automaticMigrationFrom: "0.5.12",
    status: "supported",
  },
  {
    template: "0.5.x",
    platform: "0.5.x",
    tooling: "0.5.x",
    node: ">=22.13.0",
    automaticMigrationFrom: "0.5.12",
    status: "supported",
  },
];

export function parseVersion(input) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input ?? "");
  if (!match) return null;
  return {
    raw: input,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Exact semver required: " + left + ", " + right);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function versionFromRange(range) {
  if (typeof range !== "string" || range === "workspace:*") return null;
  return parseVersion(range.replace(/^[~^=]/, ""))?.raw.replace(/^v/, "") ?? null;
}

export function sameReleaseLine(version, expected = TOOLING_VERSION) {
  const actual = parseVersion(version);
  const target = parseVersion(expected);
  return Boolean(
    actual && target && actual.major === target.major && actual.minor === target.minor,
  );
}

export function supportsAutomaticMigration(version) {
  const parsed = parseVersion(version);
  const minimum = parseVersion(MIN_AUTOMATIC_MIGRATION_VERSION);
  const target = parseVersion(TOOLING_VERSION);
  if (!parsed || !minimum || !target) return false;
  return (
    parsed.major === target.major && compareVersions(version, MIN_AUTOMATIC_MIGRATION_VERSION) >= 0
  );
}
