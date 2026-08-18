import { describe, expect, it } from "vitest";

import {
  applyTextPatches,
  HOOKS,
  insertAfter,
  mergePackageJsonManifest,
  PatchError,
  resolvePluginIds,
} from "../bin/create-app/plugins/apply.mjs";
import { knownPluginFlags, pluginsById } from "../bin/create-app/plugins/registry.mjs";
import { renderTemplates } from "../bin/create-app/templates.mjs";

const base = { name: "investment-web", title: "Yatırım", port: 3010, metricsPort: 9010 };

describe("create-app plugin engine", () => {
  it("insertAfter fails when anchor is missing", () => {
    expect(() =>
      insertAfter("hello", "// missing", "\nworld", { pluginId: "test", path: "x.ts" }),
    ).toThrow(PatchError);
  });

  it("insertAfter rejects duplicate content", () => {
    const source = `before\n${HOOKS.MIDDLEWARE_EXPORTS}\n  already,\n`;
    expect(() =>
      insertAfter(source, HOOKS.MIDDLEWARE_EXPORTS, "\n  already,", {
        pluginId: "test",
        path: "middleware.ts",
      }),
    ).toThrow(PatchError);
  });

  it("mergePackageJsonManifest merges scripts without overwriting different values", () => {
    const merged = mergePackageJsonManifest(
      { scripts: { dev: "origin-dev" } },
      { scripts: { "compose:up": "origin-compose-up" } },
    );
    expect(merged.scripts).toEqual({
      dev: "origin-dev",
      "compose:up": "origin-compose-up",
    });
  });

  it("applyTextPatches supports replaceBlock", () => {
    const result = applyTextPatches(
      "before <!-- hook --> after",
      [{ type: "replaceBlock", anchor: "<!-- hook -->", replacement: "REPLACED" }],
      { pluginId: "test", path: "README.md" },
    );
    expect(result).toBe("before REPLACED after");
  });

  it("resolvePluginIds keeps backward compat with withOps", () => {
    expect(resolvePluginIds({ withOps: true })).toEqual(["with-ops"]);
    expect(resolvePluginIds({ plugins: ["with-ops"], withOps: false })).toEqual(["with-ops"]);
    expect(resolvePluginIds({})).toEqual([]);
  });
});

describe("renderTemplates — plugins", () => {
  it("leaves no ops assets when no plugin is enabled", () => {
    const files = renderTemplates({ ...base, mode: "standalone", version: "^0.1.0" });
    expect(files["docker-compose.yml"]).toBeUndefined();
    expect(files["k8s/deployment.yaml"]).toBeUndefined();
    expect(files["OPERATIONS.md"]).toBeUndefined();
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.scripts["compose:up"]).toBeUndefined();
    const metadata = JSON.parse(files[".originloom/project.json"]);
    expect(metadata.plugins).toEqual([]);
    expect(metadata.schemaVersion).toBe(2);
    expect(files["README.md"]).not.toContain("readme-ops-table");
    expect(files["README.md"]).not.toContain("pnpm compose:up");
  });

  it("ships ops inventory with --with-ops", () => {
    const files = renderTemplates({
      ...base,
      mode: "standalone",
      version: "^0.1.0",
      withOps: true,
    });
    for (const path of [
      "docker-compose.yml",
      "k8s/deployment.yaml",
      "k8s/prometheus-rules.yaml",
      "OPERATIONS.md",
      "load-test/run.mjs",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.scripts["compose:up"]).toBe("origin-compose-up");
    expect(pkg.scripts.loadtest).toBe("node load-test/run.mjs");
    const metadata = JSON.parse(files[".originloom/project.json"]);
    expect(metadata.plugins).toEqual(["with-ops"]);
    expect(files["README.md"]).toContain("pnpm compose:up");
    expect(files["README.md"]).not.toContain("readme-ops-table");
  });

  it("registers known plugin flags", () => {
    expect(knownPluginFlags()).toContain("--with-ops");
    expect(pluginsById.has("with-ops")).toBe(true);
  });
});
