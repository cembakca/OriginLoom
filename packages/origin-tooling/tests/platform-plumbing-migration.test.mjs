import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { migrations, PLATFORM_PLUMBING_MIGRATION } from "../bin/upgrade/migrations.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const migration = migrations.find(({ id }) => id === PLATFORM_PLUMBING_MIGRATION);

function projectWith(files) {
  const root = mkdtempSync(join(tmpdir(), "originloom-plumbing-"));
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

const GENERATED_BFF_HTTP = `import { withBffAuthCookies } from "@originloom/core/auth/bff";

export function bffJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}
`;

const GENERATED_BFF_AUTH = `import { authenticateBffRequest } from "@originloom/core/auth/bff";

export async function requireBffAuth(request: Request) {
  return authenticateBffRequest(request);
}
`;

const GENERATED_DIAGNOSTICS = `export function logSsrOutcome(): void {}
`;

describe(PLATFORM_PLUMBING_MIGRATION, () => {
  it("points the copied plumbing's importers at the platform package", () => {
    const root = projectWith({
      "server/lib/bff-http.ts": GENERATED_BFF_HTTP,
      "server/api/session.ts": `import { requireBffAuth } from "@server/lib/bff-auth";
import { bffJson } from "@server/lib/bff-http";
import { recordUpstreamCall } from "@server/diagnostics/ssr-diagnostics";
import { gatewayFetch } from "@server/diagnostics/gateway";
`,
    });

    const { fileWrites } = run(root);

    expect(fileWrites["server/api/session.ts"])
      .toBe(`import { requireBffAuth } from "@originloom/core/bff";
import { bffJson } from "@originloom/core/bff";
import { recordUpstreamCall } from "@originloom/core/diagnostics/request-trace";
import { gatewayFetch } from "@originloom/core/adapters/gateway";
`);
  });

  it("drops the request argument bindRequestPath no longer takes", () => {
    const root = projectWith({
      "server/services/shell-data.ts": `import { bindRequestPath } from "@server/diagnostics/ssr-diagnostics";

bindRequestPath(ctx.request, ctx.publicPath ?? new URL(ctx.request.url).pathname);
`,
    });

    const { fileWrites } = run(root);

    expect(fileWrites["server/services/shell-data.ts"]).toContain(
      "bindRequestPath(ctx.publicPath ?? new URL(ctx.request.url).pathname);",
    );
  });

  it("removes the copies once nothing imports them", () => {
    const root = projectWith({
      "server/lib/bff-http.ts": GENERATED_BFF_HTTP,
      "server/lib/bff-auth.ts": GENERATED_BFF_AUTH,
      "server/diagnostics/ssr-diagnostics.ts": GENERATED_DIAGNOSTICS,
    });

    const { fileWrites, changes, manualRequired } = run(root);

    expect(fileWrites["server/lib/bff-http.ts"]).toBeNull();
    expect(fileWrites["server/lib/bff-auth.ts"]).toBeNull();
    expect(fileWrites["server/diagnostics/ssr-diagnostics.ts"]).toBeNull();
    expect(manualRequired).toEqual([]);
    expect(changes.filter(({ kind }) => kind === "remove")).toHaveLength(3);
  });

  /**
   * The point of the marker check: an app that put its own code in one of these
   * files owns it, and a migration that deletes it would be destroying work no
   * backup makes obvious.
   */
  it("refuses to delete a copy the app has made its own", () => {
    const root = projectWith({
      "server/lib/bff-http.ts": `export function productSpecificEnvelope(): Response {
  return new Response();
}
`,
    });

    const { fileWrites, manualRequired } = run(root);

    expect(fileWrites["server/lib/bff-http.ts"]).toBeUndefined();
    expect(manualRequired).toEqual([expect.objectContaining({ file: "server/lib/bff-http.ts" })]);
  });

  it("is a no-op on an app that has already been migrated", () => {
    const root = projectWith({
      "server/api/session.ts": `import { requireBffAuth } from "@originloom/core/bff";\n`,
    });

    const { fileWrites, changes, manualRequired } = run(root);

    expect(fileWrites).toEqual({});
    expect(changes).toEqual([]);
    expect(manualRequired).toEqual([]);
  });
});
