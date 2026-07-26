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

describe("renderTemplates — example routes", () => {
  it("ships all example route files and registers them", () => {
    const files = standalone();
    for (const path of [
      "server/routes/catalog.tsx",
      "server/routes/item-detail.tsx",
      "server/routes/account.tsx",
      "server/routes/live.tsx",
      "server/services/items.ts",
      "server/api/index.ts",
      "src/features/catalog/catalog-page.tsx",
      "src/features/items/item-detail-page.tsx",
      "src/features/live/live-page.tsx",
      "src/islands/account-panel.tsx",
      "src/islands/live-ticks.tsx",
      "src/lib/pagination.ts",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
    const routeTable = files["server/routes/index.ts"];
    for (const id of ["catalog", "itemDetail", "account", "live"]) {
      expect(routeTable, `route ${id} not registered`).toContain(id);
    }
  });

  it("demonstrates a dynamic route with validateParams + notFound + a slug cache key", () => {
    const route = standalone()["server/routes/item-detail.tsx"];
    expect(route).toContain('path: "/items/:slug"');
    expect(route).toContain("validateParams");
    expect(route).toContain("notFound()");
    expect(route).toContain("generateMetadata");
    expect(standalone()["src/lib/cache-keys.ts"]).toContain("ctx.params.slug");
  });

  it("makes the personal route never-cached (registry strategy) with a defer island", () => {
    const cacheKeys = standalone()["src/lib/cache-keys.ts"];
    expect(cacheKeys).toMatch(/account[\s\S]*?strategy: "never"/);
    expect(standalone()["server/routes/account.tsx"]).toContain('mode="defer"');
  });

  it("wires streaming + SSE: streaming route, Suspense, EventSource island, /api/ticks mount", () => {
    const files = standalone();
    expect(files["server/routes/live.tsx"]).toContain("streaming: true");
    expect(files["src/features/live/live-page.tsx"]).toContain("Suspense");
    expect(files["src/islands/live-ticks.tsx"]).toContain("new EventSource");
    expect(files["server/api/index.ts"]).toContain('"/api/ticks"');
    expect(files["server/index.ts"]).toContain("mounts: { api: mountApi }");
  });
});

describe("renderTemplates — vanilla renderer", () => {
  const vanilla = (over = {}) =>
    renderTemplates({
      ...base,
      mode: "workspace",
      version: "^0.1.0",
      renderer: "vanilla",
      ...over,
    });

  it("emits the same file set in both modes", () => {
    const standaloneVanilla = renderTemplates({
      ...base,
      mode: "standalone",
      version: "^0.1.0",
      renderer: "vanilla",
    });
    expect(Object.keys(vanilla()).sort()).toEqual(Object.keys(standaloneVanilla).sort());
  });

  it("ships no React anywhere in the generated app", () => {
    const files = vanilla();
    const pkg = JSON.parse(files["package.json"]);
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(declared.filter((name) => /react/i.test(name))).toEqual([]);
    expect(declared).toContain("@originloom/vanilla");

    for (const [path, contents] of Object.entries(files)) {
      expect(path.endsWith(".tsx"), `${path} is a .tsx file`).toBe(false);
      if (path.endsWith(".ts") || path.endsWith(".css")) {
        expect(contents, `${path} mentions react`).not.toMatch(/@originloom\/react|"react"/);
      }
    }
  });

  it("emits pages and islands instead of React components", () => {
    const files = vanilla();
    for (const path of [
      "server/routes/home.ts",
      "server/product/renderer.ts",
      "server/product/boundary-pages.ts",
      "src/pages/home.ts",
      "src/islands/counter.ts",
      "src/components/layout.ts",
      "src/entry.client.ts",
      "src/hydrate.client.ts",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
    expect(files).not.toHaveProperty(["src/global.d.ts"]);
    expect(files["server/product/renderer.ts"]).toContain("createHtmlRenderer");
    expect(files["server/product/runtime.ts"]).toContain("renderer: productRenderer");
    expect(files["src/hydrate.client.ts"]).toContain(
      'import.meta.glob<IslandModule>("./islands/*.ts")',
    );
  });

  it("drops the JSX compiler option from a standalone tsconfig", () => {
    const react = JSON.parse(
      renderTemplates({ ...base, mode: "standalone", version: "^0.1.0" })["tsconfig.json"],
    );
    const vanillaTs = JSON.parse(
      renderTemplates({ ...base, mode: "standalone", version: "^0.1.0", renderer: "vanilla" })[
        "tsconfig.json"
      ],
    );
    expect(react.compilerOptions.jsx).toBe("react-jsx");
    expect(vanillaTs.compilerOptions.jsx).toBeUndefined();
  });

  it("scans the vanilla package for Tailwind classes", () => {
    expect(vanilla()["src/styles/globals.css"]).toContain("packages/origin-vanilla/src");
    expect(
      renderTemplates({ ...base, mode: "standalone", version: "^0.1.0", renderer: "vanilla" })[
        "src/styles/globals.css"
      ],
    ).toContain("node_modules/@originloom/vanilla/dist");
  });

  it("ships renderer-specific skills and CLAUDE.md", () => {
    const files = vanilla();
    expect(files[".claude/skills/islands/SKILL.md"]).toContain("IslandMount");
    expect(files[".claude/skills/islands/SKILL.md"]).not.toContain("useState");
    expect(files[".claude/skills/add-page/SKILL.md"]).toContain("@originloom/vanilla/lib/types");
    expect(files["CLAUDE.md"]).toContain("createHtmlRenderer");
    // Skills with no renderer-specific content are shared verbatim.
    expect(files[".claude/skills/caching/SKILL.md"]).toBe(
      workspace()[".claude/skills/caching/SKILL.md"],
    );
  });
});

describe("renderTemplates — generated apps satisfy their own tooling", () => {
  const modes = [
    ["react", renderTemplates({ ...base, mode: "workspace", version: "^0.1.0" })],
    [
      "vanilla",
      renderTemplates({ ...base, mode: "workspace", version: "^0.1.0", renderer: "vanilla" }),
    ],
  ];

  it.each(modes)("%s: typechecks and lints its tests too", (_name, files) => {
    // Without this the repo's typed lint reports "not found by the project
    // service" for every generated test file.
    expect(JSON.parse(files["tsconfig.json"]).include).toContain("tests");
  });

  it.each(modes)("%s: points readAssets at an entry module it actually ships", (_name, files) => {
    // A mismatch 404s on the Vite dev server and nothing hydrates — silently.
    const clientEntry = /clientEntry: "([^"]+)"/.exec(files["server/index.ts"])?.[1];
    expect(clientEntry, "server/index.ts must pass clientEntry").toBeDefined();
    expect(Object.keys(files)).toContain(clientEntry.replace(/^\//, ""));
  });

  it.each(modes)("%s: keeps import groups sorted the way eslint wants", (_name, files) => {
    for (const [path, contents] of Object.entries(files)) {
      if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
      for (const group of contents.split("\n\n")) {
        const specifiers = [...group.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
        const aliased = specifiers.filter((s) => s.startsWith("~/") || s.startsWith("@server/"));
        expect(aliased, `${path}: unsorted import group`).toEqual([...aliased].sort());
      }
    }
  });
});
