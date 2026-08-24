import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderTemplates } from "../bin/create-app/templates.mjs";
import { DISPOSABLE_GATEWAY_MIGRATION, migrations } from "../bin/upgrade/migrations.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const migration = migrations.find(({ id }) => id === DISPOSABLE_GATEWAY_MIGRATION);

function projectWith(files) {
  const root = mkdtempSync(join(tmpdir(), "originloom-disposable-"));
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

const TSCONFIG_0_7_33 = `{
  "compilerOptions": {
    // App-owned: keep the comment through the migration.
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true
  }
}
`;

const ADAPTER_0_7_33 = `import * as coreGateway from "@originloom/core/adapters/gateway";

export async function gatewayFetch(
  input: string | URL | Request,
  init?: FetchInit,
): Promise<Response> {
  return coreGateway.gatewayFetch(extractPath(input), init);
}

export async function gatewayFetchWithIdentity(
  request: Request,
  path: string,
  init?: FetchInit,
): Promise<Response> {
  return coreGateway.gatewayFetchWithIdentity(request, path, init);
}

export async function requireGatewayOk(response: Response, message: string): Promise<void> {
  return coreGateway.requireGatewayOk(response, message);
}
`;

describe("0.7.34 disposable gateway migration", () => {
  it("adds the disposable lib next to the ES lib, leaving the rest of the file alone", () => {
    const { fileWrites, manualRequired } = run(projectWith({ "tsconfig.json": TSCONFIG_0_7_33 }));
    const patched = fileWrites["tsconfig.json"];

    expect(manualRequired).toEqual([]);
    expect(patched).toContain('"lib": ["ES2022", "ESNext.Disposable", "DOM", "DOM.Iterable"]');
    // A JSON round trip would have eaten this; the app owns its own file.
    expect(patched).toContain("// App-owned: keep the comment through the migration.");
    expect(JSON.parse(patched.replace(/^\s*\/\/.*$/gm, "")).compilerOptions.lib).toEqual([
      "ES2022",
      "ESNext.Disposable",
      "DOM",
      "DOM.Iterable",
    ]);
  });

  // The wrapper's declared return type is what makes `await using` reject at the
  // service, pointing the error away from the adapter that actually caused it.
  it("stops the app's gateway adapter from erasing the disposable type", () => {
    const { fileWrites } = run(projectWith({ "server/diagnostics/gateway.ts": ADAPTER_0_7_33 }));
    const patched = fileWrites["server/diagnostics/gateway.ts"];

    expect(patched.match(/Promise<coreGateway\.GatewayResponse>/g)).toHaveLength(2);
    // requireGatewayOk returns void and must not be touched.
    expect(patched).toContain("export async function requireGatewayOk");
    expect(patched).toContain("message: string): Promise<void>");
  });

  it("is idempotent", () => {
    const root = projectWith({
      "tsconfig.json": TSCONFIG_0_7_33,
      "server/diagnostics/gateway.ts": ADAPTER_0_7_33,
    });
    const first = run(root);
    for (const [path, content] of Object.entries(first.fileWrites)) {
      writeFileSync(join(root, path), content);
    }

    const second = run(root);
    expect(second.changes).toEqual([]);
    expect(second.fileWrites).toEqual({});
  });

  it("is a no-op on the tsconfig the current template already generates", () => {
    const files = renderTemplates({
      name: "t",
      title: "T",
      port: 3010,
      metricsPort: 9010,
      mode: "standalone",
      version: "^0.7.34",
    });

    const { changes, fileWrites } = run(projectWith({ "tsconfig.json": files["tsconfig.json"] }));
    expect(changes).toEqual([]);
    expect(fileWrites).toEqual({});
  });

  it("asks for a manual edit when the lib list is not one it recognises", () => {
    const { changes, manualRequired } = run(
      projectWith({ "tsconfig.json": '{ "compilerOptions": { "lib": ["dom"] } }' }),
    );

    expect(changes.map(({ kind }) => kind)).toEqual(["manual-required"]);
    expect(manualRequired[0].detail).toContain("ESNext.Disposable");
  });

  it("leaves a project without either file alone", () => {
    const { changes, fileWrites } = run(projectWith({}));
    expect(changes).toEqual([]);
    expect(fileWrites).toEqual({});
  });
});
