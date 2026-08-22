import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { migrations, WARM_PATH_PERFORMANCE_MIGRATION } from "../bin/upgrade/migrations.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const migration = migrations.find(({ id }) => id === WARM_PATH_PERFORMANCE_MIGRATION);

function projectWith(policy) {
  const root = mkdtempSync(join(tmpdir(), "originloom-warm-path-"));
  scratch.push(root);
  if (policy !== undefined) {
    writeFileSync(join(root, "performance-policy.json"), `${JSON.stringify(policy, null, 2)}\n`);
  }
  return root;
}

function run(root) {
  const changes = [];
  const fileWrites = {};
  migration.migrateProject(root, changes, fileWrites);
  return { changes, fileWrites };
}

const legacyPolicy = {
  schemaVersion: 1,
  payloadBudgets: { htmlBytes: 102_400 },
  regression: {
    rpsMedianDropPercent: 10,
    latencyP95IncreasePercent: 20,
    latencyP99IncreasePercent: 25,
  },
};

describe("warm path performance migration", () => {
  it("renames the p95 threshold to the percentile autocannon actually reports", () => {
    const { changes, fileWrites } = run(projectWith(legacyPolicy));
    const patched = JSON.parse(fileWrites["performance-policy.json"]);

    expect(patched.regression).not.toHaveProperty("latencyP95IncreasePercent");
    expect(patched.regression.latencyP97_5IncreasePercent).toBe(20);
    expect(changes.map(({ kind }) => kind)).toEqual(["patch"]);
  });

  // The gate must not silently get stricter or looser: this migration corrects
  // what the threshold is *called*, never what it enforces.
  it("preserves the threshold value, the sibling thresholds and the key order", () => {
    const { fileWrites } = run(projectWith(legacyPolicy));
    const patched = JSON.parse(fileWrites["performance-policy.json"]);

    expect(Object.keys(patched.regression)).toEqual([
      "rpsMedianDropPercent",
      "latencyP97_5IncreasePercent",
      "latencyP99IncreasePercent",
    ]);
    expect(patched.regression.rpsMedianDropPercent).toBe(10);
    expect(patched.regression.latencyP99IncreasePercent).toBe(25);
    expect(patched.payloadBudgets).toEqual({ htmlBytes: 102_400 });
    expect(patched.schemaVersion).toBe(1);
  });

  it("is a no-op on an already-migrated policy", () => {
    const root = projectWith(legacyPolicy);
    writeFileSync(
      join(root, "performance-policy.json"),
      run(root).fileWrites["performance-policy.json"],
    );

    const second = run(root);
    expect(second.changes).toEqual([]);
    expect(second.fileWrites).toEqual({});
  });

  it("leaves a project without a performance policy alone", () => {
    const { changes, fileWrites } = run(projectWith(undefined));
    expect(changes).toEqual([]);
    expect(fileWrites).toEqual({});
  });

  // A hand-written or reshaped policy is the app's, not ours to rewrite blind.
  it("asks for a manual edit rather than guessing at an unparseable policy", () => {
    const root = mkdtempSync(join(tmpdir(), "originloom-warm-path-"));
    scratch.push(root);
    writeFileSync(join(root, "performance-policy.json"), "{ not json");

    const { changes, fileWrites } = run(root);
    expect(fileWrites).toEqual({});
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("manual-required");
    expect(changes[0].detail).toContain("latencyP97_5IncreasePercent");
  });
});
