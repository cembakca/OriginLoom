import { describe, expect, it } from "vitest";

import { migrations, NODE_24_MIGRATION } from "../bin/upgrade/migrations.mjs";

const FLOOR = ">=24.18.1";
const migration = migrations.find(({ id }) => id === NODE_24_MIGRATION);

/**
 * Node 22 has been in maintenance since 2025-10-21; Node 24 is Active LTS
 * until 2028-04-30. The floor is 24's newest security release, because a lower
 * one tells a consumer that a runtime missing published Node security fixes is
 * supported — the opposite of what an engines range is for.
 */
describe("node 24 migration", () => {
  it("raises an existing project to the current floor", () => {
    const manifest = { engines: { node: ">=22.23.2" } };
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(manifest.engines.node).toBe(FLOOR);
    expect(changes).not.toEqual([]);
  });

  it("adds the floor to a project that never declared one", () => {
    const manifest = {};
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(manifest.engines.node).toBe(FLOOR);
  });

  /**
   * Types ahead of the runtime are worse than no types: an API that does not
   * exist on the supported Node compiles clean and fails in production.
   */
  it("brings @types/node onto the same major as the floor", () => {
    const manifest = { devDependencies: { "@types/node": "^22.20.1" } };
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(manifest.devDependencies["@types/node"]).toBe("^24.13.3");
  });

  it("does not add @types/node to a project that never had it", () => {
    const manifest = { devDependencies: {} };

    migration.migratePackage(manifest, []);

    expect(manifest.devDependencies["@types/node"]).toBeUndefined();
  });

  it("is a no-op on a project already at the floor", () => {
    const manifest = { engines: { node: FLOOR } };
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(manifest.engines.node).toBe(FLOOR);
    expect(changes).toEqual([]);
  });

  it("does not apply before the release that introduces it", () => {
    // A freshly generated app must be healthy, not carrying a pending migration
    // from a version that is not out yet.
    expect(migration.introducedIn).toBe("0.7.26");
  });
});
