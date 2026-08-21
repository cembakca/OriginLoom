import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CACHE_PERFORMANCE_ACCEPTANCE_MIGRATION, migrations } from "../bin/upgrade/migrations.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("cache performance acceptance migration", () => {
  it("adds an additive gate to capacity-enabled projects without overwriting their runner", () => {
    const root = mkdtempSync(join(tmpdir(), "originloom-cache-acceptance-"));
    scratch.push(root);
    mkdirSync(join(root, "load-test"), { recursive: true });
    writeFileSync(join(root, "load-test/capacity.mjs"), "// app-owned capacity runner\n");
    const manifest = { scripts: { capacity: "node load-test/capacity.mjs" } };
    const changes = [];
    const fileWrites = {};
    const migration = migrations.find(({ id }) => id === CACHE_PERFORMANCE_ACCEPTANCE_MIGRATION);

    migration.migratePackage(manifest, changes);
    migration.migrateProject(root, changes, fileWrites);

    expect(manifest.scripts["cache:acceptance"]).toContain("--topology memory");
    expect(manifest.scripts["cache:acceptance:redis"]).toContain("--topology redis");
    expect(manifest.scripts["performance:gate"]).toContain("cache-acceptance.mjs");
    expect(fileWrites).toHaveProperty(["load-test/cache-acceptance.mjs"]);
    expect(fileWrites).toHaveProperty(["load-test/cache-worker.mjs"]);
    expect(fileWrites).toHaveProperty(["docs/cache-performance-acceptance.md"]);
    expect(fileWrites).not.toHaveProperty(["load-test/capacity.mjs"]);
  });
});
