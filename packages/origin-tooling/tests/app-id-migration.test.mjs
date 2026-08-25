import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { APP_ID_MIGRATION, migrations } from "../bin/upgrade/migrations.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const migration = migrations.find(({ id }) => id === APP_ID_MIGRATION);

function projectWith(files) {
  const root = mkdtempSync(join(tmpdir(), "originloom-app-id-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function run(root) {
  const changes = [];
  const fileWrites = {};
  const manualRequired = [];
  migration.migrateProject(root, changes, fileWrites, manualRequired);
  return { changes, fileWrites, manualRequired };
}

const ENV = "NODE_ENV=production\nRELEASE_ID=1\nPORT=3010\n";

describe(APP_ID_MIGRATION, () => {
  it("writes the app's own name next to RELEASE_ID", () => {
    const root = projectWith({
      ".originloom/project.json": JSON.stringify({ scaffold: { name: "sigorta" } }),
      ".env.production": ENV,
      ".env.development": "NODE_ENV=development\nRELEASE_ID=dev\n",
    });

    const { fileWrites } = run(root);

    expect(fileWrites[".env.production"]).toContain("APP_ID=sigorta");
    expect(fileWrites[".env.development"]).toContain("APP_ID=sigorta");
    // Next to the variable it is most often confused with, so the comment lands
    // where someone is already reading.
    expect(fileWrites[".env.production"]).toMatch(/RELEASE_ID=1\n[\s\S]*APP_ID=sigorta/);
  });

  /**
   * The scaffold name, not the package name: an app can be renamed as a package
   * without its deployment identity moving, and this value must not change once
   * production holds coordination state under it.
   */
  it("prefers the recorded scaffold name over the package name", () => {
    const root = projectWith({
      ".originloom/project.json": JSON.stringify({ scaffold: { name: "sigorta" } }),
      "package.json": JSON.stringify({ name: "@corp/insurance-web" }),
      ".env.production": ENV,
    });

    expect(run(root).fileWrites[".env.production"]).toContain("APP_ID=sigorta");
  });

  it("falls back to the package name, without its scope", () => {
    const root = projectWith({
      "package.json": JSON.stringify({ name: "@corp/insurance-web" }),
      ".env.production": ENV,
    });

    expect(run(root).fileWrites[".env.production"]).toContain("APP_ID=insurance-web");
  });

  it("asks rather than guesses when no name can be derived", () => {
    const root = projectWith({ ".env.production": ENV });

    const { fileWrites, manualRequired } = run(root);

    expect(fileWrites).toEqual({});
    expect(manualRequired).toEqual([expect.objectContaining({ file: ".env.production" })]);
  });

  /**
   * Both env files and the release note point at this guide; in an upgraded app
   * it would otherwise be a dangling reference.
   */
  it("brings the guide the new comments point at", () => {
    const root = projectWith({
      ".originloom/project.json": JSON.stringify({ scaffold: { name: "sigorta" } }),
      ".env.production": ENV,
    });

    expect(run(root).fileWrites["docs/namespaces.md"]).toContain("APP_ID");
  });

  it("never overwrites a guide the app already has", () => {
    const root = projectWith({
      ".originloom/project.json": JSON.stringify({ scaffold: { name: "sigorta" } }),
      ".env.production": ENV,
      "docs/namespaces.md": "# bizim notlarımız\n",
    });

    expect(run(root).fileWrites["docs/namespaces.md"]).toBeUndefined();
  });

  it("leaves an app that already has one alone", () => {
    const root = projectWith({
      ".originloom/project.json": JSON.stringify({ scaffold: { name: "sigorta" } }),
      ".env.production": `${ENV}APP_ID=insurance\n`,
    });

    expect(run(root).fileWrites[".env.production"]).toBeUndefined();
  });
});
