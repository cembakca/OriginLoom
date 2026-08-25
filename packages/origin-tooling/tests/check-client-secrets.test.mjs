import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const check = join(dirname(fileURLToPath(import.meta.url)), "../bin/check-client-secrets.mjs");
const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function appWith(files) {
  const root = mkdtempSync(join(tmpdir(), "originloom-secrets-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function run(root, env) {
  try {
    const stdout = execFileSync(process.execPath, [check], {
      env: { ORIGIN_APP_ROOT: root, PATH: process.env.PATH, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

const SECRET = "s3cr3t-value-long-enough";

describe("check-client-secrets", () => {
  it("fails when a secret's value reached the bundle", () => {
    const root = appWith({
      "dist/client/assets/island.js": `export const token = "${SECRET}";`,
    });

    const { status, output } = run(root, { CACHE_PURGE_SECRET: SECRET });

    expect(status).toBe(1);
    expect(output).toContain("CACHE_PURGE_SECRET");
    expect(output).toContain("dist/client/assets/island.js");
  });

  it("passes a bundle that carries none of them", () => {
    const root = appWith({ "dist/client/assets/island.js": "export const greeting = 'merhaba';" });

    expect(run(root, { CACHE_PURGE_SECRET: SECRET }).status).toBe(0);
  });

  /**
   * The name is not the leak and flagging it would make this the kind of check
   * people switch off: bundlers inline variable names into dead code and source
   * maps all the time.
   */
  it("does not flag a secret's name", () => {
    const root = appWith({
      "dist/client/assets/island.js": 'export const key = "CACHE_PURGE_SECRET";',
    });

    expect(run(root, { CACHE_PURGE_SECRET: SECRET }).status).toBe(0);
  });

  /**
   * A short value is a placeholder or a `1`, and it collides with ordinary
   * bundle content. A check that cries wolf on those is a check nobody reads.
   */
  it("ignores values too short to be a credential", () => {
    const root = appWith({ "dist/client/assets/island.js": 'export const mode = "dev";' });

    expect(run(root, { SESSION_TOKEN: "dev" }).status).toBe(0);
  });

  it("checks a name the app declares even when it breaks the convention", () => {
    const root = appWith({
      "dist/client/assets/island.js": `export const value = "${SECRET}";`,
    });

    const { status, output } = run(root, {
      GATEWAY_CREDENTIAL: SECRET,
      ORIGINLOOM_EXTRA_SECRETS: "GATEWAY_CREDENTIAL",
    });

    expect(status).toBe(1);
    expect(output).toContain("GATEWAY_CREDENTIAL");
  });

  it("says where to look when there is no client build", () => {
    const root = appWith({ "package.json": "{}" });

    expect(run(root, {}).status).toBe(1);
  });
});
