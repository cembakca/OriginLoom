import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JSON_SCHEMA_CONTRACTS_MIGRATION, migrations } from "../bin/upgrade/migrations.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const migration = migrations.find(({ id }) => id === JSON_SCHEMA_CONTRACTS_MIGRATION);

function projectWith(files) {
  const root = mkdtempSync(join(tmpdir(), "originloom-contracts-"));
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

const LEGACY_OPENAPI = JSON.stringify(
  {
    openapi: "3.1.0",
    info: { title: "Gateway", version: "1.0.0" },
    paths: { "/menu": { get: { operationId: "menu.list" } } },
    components: {
      schemas: {
        MenuItem: {
          type: "object",
          properties: {
            children: { type: "array", items: { $ref: "#/components/schemas/MenuItem" } },
          },
        },
        Menu: { $ref: "#/components/schemas/MenuItem" },
      },
    },
  },
  null,
  2,
);

const LEGACY_MANIFEST = JSON.stringify(
  {
    schemaVersion: 2,
    schema: "openapi.json",
    contracts: [
      {
        id: "menu",
        operationId: "menu.list",
        request: { method: "GET", path: "/menu" },
        response: {
          status: 200,
          contentType: "application/json",
          fixture: "fixtures/menu.json",
          schema: "#/components/schemas/Menu",
        },
      },
    ],
  },
  null,
  2,
);

describe("0.7.52 JSON Schema contracts migration", () => {
  it("moves the schemas out of the envelope and deletes the file that held it", () => {
    const { changes, fileWrites, manualRequired } = run(
      projectWith({
        "contracts/openapi.json": LEGACY_OPENAPI,
        "contracts/gateway-contracts.json": LEGACY_MANIFEST,
      }),
    );

    expect(manualRequired).toEqual([]);
    const document = JSON.parse(fileWrites["contracts/gateway-schemas.json"]);
    expect(document.$defs.Menu.$ref).toBe("#/$defs/MenuItem");
    // The envelope is gone, not emptied.
    expect(document.paths).toBeUndefined();
    expect(document.openapi).toBeUndefined();
    // A null write is a removal.
    expect(fileWrites["contracts/openapi.json"]).toBeNull();
    expect(changes.map(({ kind }) => kind)).toContain("remove");
  });

  /** A recursive schema is the case an inlining converter would have destroyed. */
  it("keeps a self-referential ref pointing at the new location", () => {
    const { fileWrites } = run(
      projectWith({
        "contracts/openapi.json": LEGACY_OPENAPI,
        "contracts/gateway-contracts.json": LEGACY_MANIFEST,
      }),
    );
    const document = JSON.parse(fileWrites["contracts/gateway-schemas.json"]);

    expect(document.$defs.MenuItem.properties.children.items.$ref).toBe("#/$defs/MenuItem");
  });

  it("repoints the manifest at the new file and the new pointers", () => {
    const { fileWrites } = run(
      projectWith({
        "contracts/openapi.json": LEGACY_OPENAPI,
        "contracts/gateway-contracts.json": LEGACY_MANIFEST,
      }),
    );
    const manifest = JSON.parse(fileWrites["contracts/gateway-contracts.json"]);

    expect(manifest.schema).toBe("gateway-schemas.json");
    expect(manifest.contracts[0].response.schema).toBe("#/$defs/Menu");
  });

  /**
   * The manifest pointing at a document that is no longer there is worse than
   * not migrating, so a missing manifest is said out loud rather than guessed at.
   */
  it("asks for a manual step when the manifest is missing", () => {
    const { manualRequired } = run(projectWith({ "contracts/openapi.json": LEGACY_OPENAPI }));

    expect(manualRequired[0].detail).toContain("gateway-schemas.json");
  });

  it("leaves a project with no contracts alone", () => {
    const { changes, fileWrites } = run(projectWith({}));
    expect(changes).toEqual([]);
    expect(fileWrites).toEqual({});
  });

  it("is idempotent once the legacy file is gone", () => {
    const root = projectWith({
      "contracts/gateway-schemas.json": '{"$defs":{}}',
      "contracts/gateway-contracts.json": LEGACY_MANIFEST.replace(
        "openapi.json",
        "gateway-schemas.json",
      ),
    });

    expect(existsSync(join(root, "contracts/openapi.json"))).toBe(false);
    expect(run(root).changes).toEqual([]);
  });
});
