import { describe, expect, it } from "vitest";

import { renderTemplates } from "../bin/create-app/templates.mjs";

const base = { name: "investment-web", title: "Yatırım", port: 3010, metricsPort: 9010 };

const standalone = (over = {}) =>
  renderTemplates({ ...base, mode: "standalone", version: "^0.1.0", ...over });
const workspace = (over = {}) =>
  renderTemplates({ ...base, mode: "workspace", version: "^0.1.0", ...over });

describe("renderTemplates — shared shape", () => {
  it("emits the same file set in both modes", () => {
    expect(Object.keys(standalone()).sort()).toEqual(Object.keys(workspace()).sort());
  });

  it("emits every file the generated app needs to boot", () => {
    const files = standalone();
    for (const path of [
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "vite.server.config.ts",
      "vitest.config.ts",
      ".env.development",
      ".env.production",
      "README.md",
      "Dockerfile",
      "server/index.ts",
      "server/routes/index.ts",
      "server/product/runtime.ts",
      "src/entry.client.tsx",
      "src/hydrate.client.tsx",
      "src/islands/counter.tsx",
      "src/lib/cache-keys.ts",
      "src/styles/globals.css",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
  });

  it("produces valid JSON for package.json and tsconfig.json in both modes", () => {
    for (const files of [standalone(), workspace()]) {
      expect(() => JSON.parse(files["package.json"])).not.toThrow();
      expect(() => JSON.parse(files["tsconfig.json"])).not.toThrow();
    }
  });

  it("threads name, title and ports into the generated files", () => {
    const files = standalone({ name: "demo-web", title: "Demo", port: 4200, metricsPort: 10200 });
    expect(JSON.parse(files["package.json"]).name).toBe("demo-web");
    expect(files["README.md"]).toContain("Demo");
    expect(files["src/lib/metadata/site-defaults.ts"]).toContain("Demo");
    expect(files[".env.development"]).toContain("PORT=4200");
    expect(files[".env.development"]).toContain("METRICS_PORT=10200");
  });
});

describe("renderTemplates — standalone mode", () => {
  it("pins @originloom/* deps to the given version range, never workspace:*", () => {
    const pkg = JSON.parse(standalone({ version: "^1.2.0" })["package.json"]);
    expect(pkg.dependencies["@originloom/core"]).toBe("^1.2.0");
    expect(pkg.dependencies["@originloom/react"]).toBe("^1.2.0");
    expect(pkg.devDependencies["@originloom/tooling"]).toBe("^1.2.0");
    const specs = [
      pkg.dependencies["@originloom/core"],
      pkg.dependencies["@originloom/react"],
      pkg.devDependencies["@originloom/tooling"],
    ];
    expect(specs).not.toContain("workspace:*");
  });

  it("approves the native build scripts its dep tree pulls in", () => {
    // A standalone repo is its own pnpm root, so it must list these itself —
    // otherwise `pnpm install` warns about ignored build scripts.
    const pkg = JSON.parse(standalone()["package.json"]);
    expect(pkg.pnpm.onlyBuiltDependencies).toEqual(
      expect.arrayContaining(["esbuild", "sharp", "@tailwindcss/oxide", "protobufjs"]),
    );
  });

  it("carries the base compiler options inline (no monorepo extends)", () => {
    const ts = JSON.parse(standalone()["tsconfig.json"]);
    expect(ts.extends).toBeUndefined();
    // A representative sample of tsconfig.base.json must be inlined.
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.target).toBe("ES2022");
    expect(ts.compilerOptions.verbatimModuleSyntax).toBe(true);
    // App-specific options still present.
    expect(ts.compilerOptions.paths).toMatchObject({ "~/*": ["./src/*"] });
  });

  it("scans the installed react dist for Tailwind classes", () => {
    const css = standalone()["src/styles/globals.css"];
    expect(css).toContain('@source "../../node_modules/@originloom/react/dist"');
    expect(css).not.toContain("packages/origin-react/src");
  });

  it("builds self-contained from the app root", () => {
    const dockerfile = standalone({ name: "demo-web" })["Dockerfile"];
    expect(dockerfile).toContain("docker build -t demo-web .");
    expect(dockerfile).toContain("COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist");
    expect(dockerfile).toContain("RUN pnpm typecheck && pnpm build");
    expect(dockerfile).not.toContain("pnpm-workspace.yaml");
    expect(dockerfile).not.toContain("--filter");
  });

  it("documents the standalone install/dev/deploy flow", () => {
    const readme = standalone({ name: "demo-web" })["README.md"];
    expect(readme).toContain("pnpm dev");
    expect(readme).toContain("docker build -t demo-web .");
    expect(readme).not.toContain("pnpm --filter");
  });
});

describe("renderTemplates — workspace mode", () => {
  it("links @originloom/* deps via workspace:* regardless of --version", () => {
    const pkg = JSON.parse(workspace({ version: "^9.9.9" })["package.json"]);
    expect(pkg.dependencies["@originloom/core"]).toBe("workspace:*");
    expect(pkg.dependencies["@originloom/react"]).toBe("workspace:*");
    expect(pkg.devDependencies["@originloom/tooling"]).toBe("workspace:*");
  });

  it("defers native build approval to the workspace root (no pnpm field)", () => {
    const pkg = JSON.parse(workspace()["package.json"]);
    expect(pkg.pnpm).toBeUndefined();
  });

  it("extends the monorepo tsconfig base", () => {
    const ts = JSON.parse(workspace()["tsconfig.json"]);
    expect(ts.extends).toBe("../../tsconfig.base.json");
    // Base options come from the parent, not inlined here.
    expect(ts.compilerOptions.strict).toBeUndefined();
    expect(ts.compilerOptions.paths).toMatchObject({ "~/*": ["./src/*"] });
  });

  it("scans the workspace react source for Tailwind classes", () => {
    const css = workspace()["src/styles/globals.css"];
    expect(css).toContain('@source "../../../../packages/origin-react/src"');
    expect(css).not.toContain("node_modules/@originloom/react/dist");
  });

  it("builds from the repo root via --filter", () => {
    const dockerfile = workspace({ name: "demo-web" })["Dockerfile"];
    expect(dockerfile).toContain(
      "pnpm --filter demo-web typecheck && pnpm --filter demo-web build",
    );
    expect(dockerfile).toContain("/repo/apps/demo-web/dist");
    expect(dockerfile).toContain("pnpm fetch");
  });

  it("documents the workspace --filter flow", () => {
    const readme = workspace({ name: "demo-web" })["README.md"];
    expect(readme).toContain("pnpm --filter demo-web dev");
  });
});
