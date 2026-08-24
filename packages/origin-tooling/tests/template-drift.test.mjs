import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { format } from "prettier";
import { afterEach, describe, expect, it } from "vitest";

import { renderTemplates } from "../bin/create-app/templates.mjs";
import { measureDrift, scaffoldParameters } from "../bin/lib/template-drift.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const SCAFFOLD = {
  name: "drift-fixture",
  title: "Drift",
  port: 3200,
  metricsPort: 9200,
  mode: "standalone",
  version: "^9.9.9",
};

/** A freshly generated app, written the way `create-app` writes it. */
async function generatedApp(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "originloom-drift-"));
  scratch.push(root);
  const files = renderTemplates(SCAFFOLD);
  const config = JSON.parse(files[".prettierrc.json"]);
  for (const [path, contents] of Object.entries(files)) {
    let formatted = contents;
    try {
      formatted = await format(contents, { ...config, filepath: path });
    } catch {
      // Same tolerance the drift measurement itself applies.
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), formatted);
  }
  for (const [path, contents] of Object.entries(overrides)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

function project(root, metadata) {
  return {
    root,
    pkg: { name: SCAFFOLD.name },
    metadata: {
      mode: "standalone",
      platformRange: SCAFFOLD.version,
      packageManager: "pnpm",
      plugins: [],
      ...metadata,
    },
  };
}

describe("template drift", () => {
  /**
   * The measurement is only worth reading if a healthy app reads as zero —
   * otherwise the signal it exists to carry is buried in its own noise.
   */
  it("reports nothing for an app that is still the template", async () => {
    const root = await generatedApp();
    const drift = await measureDrift(project(root, { scaffold: SCAFFOLD }));

    expect(drift.files).toEqual([]);
    expect(drift.total).toBe(0);
    expect(drift.missing).toEqual([]);
  });

  it("counts the lines an app has changed, worst first", async () => {
    const root = await generatedApp({
      "server/seo.ts": "export const mountSeo = () => {};\n",
      "src/lib/menu.ts": "export type Menu = never;\n",
    });

    const drift = await measureDrift(project(root, { scaffold: SCAFFOLD }));

    expect(drift.files.map(({ path }) => path)).toEqual(["src/lib/menu.ts", "server/seo.ts"]);
    expect(drift.total).toBeGreaterThan(0);
  });

  it("lists template files the app no longer has", async () => {
    const root = await generatedApp();
    rmSync(join(root, "server/seo.ts"));

    const drift = await measureDrift(project(root, { scaffold: SCAFFOLD }));

    expect(drift.missing).toContain("server/seo.ts");
    expect(drift.files.map(({ path }) => path)).not.toContain("server/seo.ts");
  });

  /**
   * A project scaffolded before the parameters were recorded cannot reproduce
   * the display title, and the files carrying it would otherwise be reported as
   * drift the app never caused.
   */
  it("declines to compare title-bearing files when the title was never recorded", async () => {
    const root = await generatedApp();
    const drift = await measureDrift(project(root, {}));

    expect(drift.uncompared).toContain("src/lib/metadata/site-defaults.ts");
    expect(drift.files.map(({ path }) => path)).not.toContain("src/lib/metadata/site-defaults.ts");
  });

  it("recovers the ports from the app's own env when metadata has none", () => {
    const root = mkdtempSync(join(tmpdir(), "originloom-drift-env-"));
    scratch.push(root);
    writeFileSync(join(root, ".env.development"), "PORT=3456\nMETRICS_PORT=9456\n");

    expect(scaffoldParameters(project(root, {}))).toMatchObject({
      name: SCAFFOLD.name,
      port: 3456,
      metricsPort: 9456,
      title: undefined,
    });
  });
});
