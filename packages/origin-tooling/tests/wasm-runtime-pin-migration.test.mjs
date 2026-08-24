import { describe, expect, it } from "vitest";

import { migrations, WASM_RUNTIME_PIN_MIGRATION } from "../bin/upgrade/migrations.mjs";

const migration = migrations.find(({ id }) => id === WASM_RUNTIME_PIN_MIGRATION);

function scaffolded() {
  return {
    devDependencies: {
      "@napi-rs/wasm-runtime": "1.1.6",
      "@vitejs/plugin-react": "^6.0.4",
      vite: "^8.1.5",
      vitest: "^4.1.10",
    },
  };
}

/**
 * The pin existed for exactly one broken release. `@napi-rs/wasm-runtime@1.2.0`
 * declared `@emnapi ^2.0.0-alpha.3` as its only peer contract; 1.2.1 widened it
 * to `^1.7.1 || ^2.0.0-alpha.3`, so no caret range can land on the broken one
 * any more. Rolldown 1.2.x then stopped publishing a wasm32-wasi binding at all,
 * which is the path the pin was guarding — removing it drops the package from
 * the lockfile entirely rather than moving it to another version.
 */
describe("wasm runtime pin migration", () => {
  it("removes the dead pin and raises the toolchain floor", () => {
    const manifest = scaffolded();
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(manifest.devDependencies).toEqual({
      "@vitejs/plugin-react": "^6.1.0",
      vite: "^8.2.2",
      vitest: "^4.1.11",
    });
    expect(changes).toHaveLength(4);
  });

  it("is a no-op the second time", () => {
    const manifest = scaffolded();
    migration.migratePackage(manifest, []);
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(changes).toEqual([]);
  });

  /** Someone else's pin is someone else's decision. */
  it("leaves a pin the scaffolder did not write", () => {
    const manifest = { devDependencies: { "@napi-rs/wasm-runtime": "1.2.3" } };
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(manifest.devDependencies["@napi-rs/wasm-runtime"]).toBe("1.2.3");
    expect(changes).toEqual([]);
  });

  /**
   * A floor is raised, never lowered: an application already ahead of the
   * platform must not be dragged back by an upgrade step.
   */
  it("does not move a project that is already ahead", () => {
    const manifest = { devDependencies: { vite: "^8.3.0", vitest: "^4.2.0" } };
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(manifest.devDependencies).toEqual({ vite: "^8.3.0", vitest: "^4.2.0" });
    expect(changes).toEqual([]);
  });

  it("says nothing about a project that declares none of them", () => {
    const manifest = { dependencies: { hono: "^4.13.3" } };
    const changes = [];

    migration.migratePackage(manifest, changes);

    expect(changes).toEqual([]);
  });
});
