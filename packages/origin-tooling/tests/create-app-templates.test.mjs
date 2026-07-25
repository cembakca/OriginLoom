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

describe("renderTemplates — Claude Code integration", () => {
  const EXPECTED = [
    "originloom-overview",
    "add-page",
    "caching",
    "data-loading",
    "islands",
    "metadata-seo",
    "tailwind-styling",
    "code-conventions",
    "testing",
    "check",
  ];

  it("ships every skill under .claude/skills/<name>/SKILL.md in both modes", () => {
    for (const files of [standalone(), workspace()]) {
      for (const name of EXPECTED) {
        expect(files, `missing skill ${name}`).toHaveProperty([`.claude/skills/${name}/SKILL.md`]);
      }
    }
  });

  it("gives each skill frontmatter whose name matches its directory", () => {
    const files = standalone();
    for (const name of EXPECTED) {
      const body = files[`.claude/skills/${name}/SKILL.md`];
      expect(body.startsWith("---\n")).toBe(true);
      expect(body).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, "m"));
      expect(body).toMatch(/^description:\s*\S/m);
    }
  });

  it("marks /check as manual-only (never auto-invoked)", () => {
    const body = standalone()[".claude/skills/check/SKILL.md"];
    expect(body).toMatch(/^disable-model-invocation:\s*true\s*$/m);
  });

  it("ships an always-loaded CLAUDE.md that points at the skills", () => {
    const claudeMd = standalone()["CLAUDE.md"];
    expect(claudeMd).toContain("OriginLoom");
    expect(claudeMd).toContain(".claude/skills/");
    expect(claudeMd).not.toMatch(/^---\n/); // CLAUDE.md takes no frontmatter
  });

  it("pre-approves only safe commands and never publish/push", () => {
    const settings = JSON.parse(standalone()[".claude/settings.json"]);
    expect(settings.permissions.allow).toContain("Bash(pnpm test)");
    expect(settings.permissions.allow).toContain("Bash(pnpm typecheck)");
    expect(settings.permissions.allow).toContain("Bash(pnpm lint)");
    const joined = settings.permissions.allow.join(" ");
    expect(joined).not.toMatch(/publish|push|Bash\(\*\)/);
  });
});

describe("renderTemplates — project features", () => {
  it("ships repo hygiene files in both modes", () => {
    for (const files of [standalone(), workspace()]) {
      for (const path of [".gitignore", ".dockerignore", ".nvmrc", ".editorconfig"]) {
        expect(files, `missing ${path}`).toHaveProperty([path]);
      }
    }
    expect(standalone()[".gitignore"]).toContain("node_modules");
    expect(standalone()[".dockerignore"]).toContain(".git");
  });

  it("ships eslint + prettier config and scripts", () => {
    const files = standalone();
    expect(files).toHaveProperty(["eslint.config.js"]);
    expect(files).toHaveProperty([".prettierrc.json"]);
    expect(files).toHaveProperty([".prettierignore"]);
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.scripts.lint).toBe("eslint .");
    expect(pkg.scripts.format).toBe("prettier --write .");
    expect(pkg.devDependencies).toHaveProperty("eslint");
    expect(pkg.devDependencies).toHaveProperty("typescript-eslint");
    expect(pkg.devDependencies).toHaveProperty("prettier");
  });

  it("ships a passing example test", () => {
    expect(standalone()).toHaveProperty(["tests/home.test.ts"]);
    expect(standalone()["tests/home.test.ts"]).toContain('from "vitest"');
  });

  it("ships the fragment showcase route wired end to end", () => {
    const files = standalone();
    // Route, page, fragment definition, and the JSX typing for <ssr-fragment>.
    for (const path of [
      "server/routes/showcase.tsx",
      "src/features/showcase/showcase-page.tsx",
      "src/features/showcase/server-time-fragment.tsx",
      "server/product/fragments.tsx",
      "src/global.d.ts",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
    // Registered in the route table and the cache registry, and the runtime uses it.
    expect(files["server/routes/index.ts"]).toContain("showcase");
    expect(files["src/lib/cache-keys.ts"]).toContain("showcase");
    expect(files["server/product/runtime.ts"]).toContain("productFragments");
    // The page carries the placeholder the stitcher targets.
    expect(files["src/features/showcase/showcase-page.tsx"]).toContain(
      '<ssr-fragment name="server-time"',
    );
  });
});
