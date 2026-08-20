import { describe, expect, it } from "vitest";

import { renderTemplates } from "../bin/create-app/templates.mjs";
import {
  PNPM_DEPENDENCY_OVERRIDES,
  YARN_RESOLUTIONS,
} from "../bin/lib/package-manager.mjs";

/** Structural YAML checks for template strings — full parse is release-verify's job. */
function assertTemplateYaml(content, path) {
  expect(content.trim().length, `${path} is empty`).toBeGreaterThan(0);
  for (const line of content.split("\n")) {
    expect(line.startsWith("\t"), `${path}: tab indent`).toBe(false);
  }
  const hasStructure =
    /^apiVersion:/m.test(content) ||
    /^kind:/m.test(content) ||
    /^services:/m.test(content) ||
    /^groups:/m.test(content);
  expect(hasStructure, `${path}: missing expected YAML structure`).toBe(true);
}

const base = { name: "investment-web", title: "Yatırım", port: 3010, metricsPort: 9010 };

const standalone = (over = {}) =>
  renderTemplates({ ...base, mode: "standalone", version: "^0.1.0", ...over });
const workspace = (over = {}) =>
  renderTemplates({ ...base, mode: "workspace", version: "^0.1.0", ...over });

describe("renderTemplates — shared shape", () => {
  it("emits the same app files while standalone owns its pnpm root config", () => {
    const standaloneFiles = Object.keys(standalone()).filter(
      (path) => path !== "pnpm-workspace.yaml",
    );
    expect(standaloneFiles.sort()).toEqual(Object.keys(workspace()).sort());
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

  it("gives every app its own Vite port so two can run dev at once", () => {
    {
      const files = renderTemplates({
        ...base,
        mode: "workspace",
        version: "^0.1.0",
        port: 3020,
        metricsPort: 9020,
      });
      expect(files[".env.development"]).toContain("VITE_DEV_SERVER_URL=http://127.0.0.1:5020");
      expect(files["vite.config.ts"]).toContain("devServer: { port: 5020 }");
      expect(files["README.md"]).toContain(":5020");
    }
  });

  it("carries its own .npmrc when a registry is given", () => {
    // npm config is not inherited from parent directories: without this file the
    // app resolves @originloom/* from npmjs and the install fails.
    const files = renderTemplates({
      ...base,
      mode: "standalone",
      version: "^0.1.0",
      registry: "https://nexus.example.com/repository/npm-private/",
    });
    expect(files[".npmrc"]).toBe(
      "@originloom:registry=https://nexus.example.com/repository/npm-private/\n",
    );
  });

  it("writes no .npmrc when no registry is given", () => {
    const files = renderTemplates({ ...base, mode: "workspace", version: "^0.1.0" });
    expect(files).not.toHaveProperty([".npmrc"]);
  });

  it("accepts an explicit Vite port", () => {
    const files = renderTemplates({
      ...base,
      mode: "workspace",
      version: "^0.1.0",
      vitePort: 6123,
    });
    expect(files[".env.development"]).toContain("VITE_DEV_SERVER_URL=http://127.0.0.1:6123");
    expect(files["vite.config.ts"]).toContain("devServer: { port: 6123 }");
  });

  it("threads name, title and ports into the generated files", () => {
    const files = standalone({ name: "demo-web", title: "Demo", port: 4200, metricsPort: 10200 });
    expect(JSON.parse(files["package.json"]).name).toBe("demo-web");
    expect(files["README.md"]).toContain("Demo");
    expect(files["src/lib/metadata/site-defaults.ts"]).toContain("Demo");
    expect(files[".env.development"]).toContain("PORT=4200");
    expect(files[".env.development"]).toContain("METRICS_PORT=10200");
  });

  it("emits import blocks in the order the generated app's own lint demands", () => {
    // A template is a string, so this repo's lint never sees inside it — only
    // the generated app's does, and it fails the whole run over import order.
    // simple-import-sort's groups, then plain alphabetical within each.
    const group = (specifier) => {
      if (specifier.startsWith("node:")) return 0;
      if (/^@?\w/.test(specifier)) return 1;
      if (specifier.startsWith(".")) return 3;
      return 2;
    };
    const sortsBefore = (a, b) => (group(a) !== group(b) ? group(a) < group(b) : a <= b);

    {
      const files = standalone();
      for (const [path, contents] of Object.entries(files)) {
        if (!/\.tsx?$/.test(path) || typeof contents !== "string") continue;
        for (const block of contents.split("\n\n")) {
          const specifiers = [...block.matchAll(/^import\s[^"']*["']([^"']+)["'];$/gm)].map(
            (match) => match[1],
          );
          // simple-import-sort orders the names inside the braces too.
          for (const named of block.matchAll(/^import\s*\{([^}]+)\}/gm)) {
            const names = named[1]
              .split(",")
              .map((name) => name.trim().replace(/^type\s+/, ""))
              .filter(Boolean);
            // Case-insensitive, with case only as a tiebreaker — the order the
            // rule actually produces (counterLines before CounterMap).
            const sorted = [...names].sort(
              (a, b) =>
                a.toLowerCase().localeCompare(b.toLowerCase(), "en") || a.localeCompare(b, "en"),
            );
            expect(names, `${path} — named imports out of order`).toEqual(sorted);
          }
          for (let index = 1; index < specifiers.length; index++) {
            expect(
              sortsBefore(specifiers[index - 1], specifiers[index]),
              `${path} — "${specifiers[index - 1]}" must not precede "${specifiers[index]}"`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("ships deployment assets only when they are asked for", () => {
    {
      const plain = standalone();
      expect(Object.keys(plain).some((path) => path.startsWith("k8s/"))).toBe(false);
      expect(plain["docker-compose.yml"]).toBeUndefined();
      expect(JSON.parse(plain["package.json"]).scripts["compose:up"]).toBeUndefined();

      const ops = standalone({
        withOps: true,
        name: "pay-web",
        port: 3040,
        metricsPort: 9040,
      });
      // The compose file names are what origin-compose-up looks for.
      expect(ops["docker-compose.yml"]).toContain('"3040:3040"');
      expect(ops["docker-compose.redis.yml"]).toContain("CACHE_BACKEND: redis");
      expect(ops["k8s/deployment.yaml"]).toContain("name: pay-web");
      expect(ops["k8s/deployment.yaml"]).toContain("containerPort: 3040");
      // The operations port carries /metrics and purge, and must stay off the ingress.
      expect(ops["k8s/network-policy.yaml"]).toContain("port: 9040");
      expect(ops["OPERATIONS.md"]).toContain("pay-web");
      expect(ops).toHaveProperty(["load-test/stress.mjs"]);
      expect(ops).toHaveProperty(["load-test/compare.mjs"]);
      expect(ops).toHaveProperty(["scripts/pentest-readiness.mjs"]);
      expect(ops["README.md"]).toContain("pnpm pentest:readiness");
      expect(ops["README.md"]).toContain("OPERATIONS.md");
      expect(ops).toHaveProperty(["load-test/capacity.mjs"]);
      expect(ops).toHaveProperty(["load-test/capacity-report.mjs"]);
      expect(ops["OPERATIONS.md"]).toContain("pnpm capacity");
      expect(JSON.parse(ops["package.json"]).scripts.capacity).toBe("node load-test/capacity.mjs");
      expect(JSON.parse(ops["package.json"]).devDependencies.autocannon).toBe("^8.0.0");
      for (const [selector, version] of Object.entries(PNPM_DEPENDENCY_OVERRIDES)) {
        expect(ops["pnpm-workspace.yaml"]).toContain(`${selector}: ${version}`);
      }
      expect(JSON.parse(ops["package.json"]).scripts["compose:redis"]).toBe(
        "origin-compose-up --redis",
      );
    }
  });

  it("instruments the mock gateway for capacity cache-collapse assertions", () => {
    const mockGateway = standalone()["mock-gateway/server.mjs"];

    expect(mockGateway).toContain('url.pathname === "/__originloom__/stats"');
    expect(mockGateway).toContain('req.method === "DELETE"');
    expect(mockGateway).toContain("MOCK_GATEWAY_DELAY_MS");
    expect(mockGateway).toContain("stats.byPath[url.pathname]");
  });

  it("keeps one product's endpoints out of the generated alert rules", () => {
    const rules = standalone({ withOps: true })["k8s/prometheus-rules.yaml"];

    // The alerts fire on metrics the platform exports, so they work for any app.
    expect(rules).toContain("ssr_cache_cardinality_overflow_total");
    expect(rules).toContain("ssr_render_rejected_total");
    expect(rules).not.toContain("market_stream");
    expect(rules).not.toContain("bot_analytics");
  });

  it("ships fourteen valid YAML files with --with-ops", () => {
    const ops = standalone({ withOps: true, name: "ops-web", port: 3050, metricsPort: 9050 });
    const yamlPaths = [
      "docker-compose.yml",
      "docker-compose.redis.yml",
      "k8s/deployment.yaml",
      "k8s/service.yaml",
      "k8s/operations-service.yaml",
      "k8s/configmap.yaml",
      "k8s/configmap.memory.yaml",
      "k8s/configmap.redis.yaml",
      "k8s/secret.yaml",
      "k8s/ingress.yaml",
      "k8s/hpa.yaml",
      "k8s/pdb.yaml",
      "k8s/network-policy.yaml",
      "k8s/prometheus-rules.yaml",
    ];
    for (const path of yamlPaths) {
      expect(ops, `missing ${path}`).toHaveProperty([path]);
      assertTemplateYaml(ops[path], path);
    }
    const opsYamlOnly = Object.keys(ops).filter(
      (path) =>
        path.startsWith("k8s/") ||
        path === "docker-compose.yml" ||
        path === "docker-compose.redis.yml",
    );
    expect(opsYamlOnly.sort()).toEqual(yamlPaths.sort());
  });

  it("defines pnpm ci as the generated app quality gate", () => {
    const ci = JSON.parse(standalone()["package.json"]).scripts.ci;
    for (const step of [
      "origin:doctor",
      "typecheck",
      "check:cycles",
      "lint",
      "format:check",
      "test",
      "build",
      "smoke",
    ]) {
      expect(ci, `ci script missing ${step}`).toContain(step);
    }
  });

  it("runs pnpm ci from generated GitHub Actions workflow", () => {
    const workflow = standalone()[".github/workflows/ci.yml"];
    expect(workflow).toContain("run: pnpm run ci");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
  });

  it("points the icons at assets the media pipeline actually produces", () => {
    {
      const defaults = standalone()["src/lib/metadata/site-defaults.ts"];
      // A dangling /favicon.ico is a 404 in the console of every generated app:
      // nothing serves it, and only /assets/* is served statically.
      expect(defaults).not.toContain("/favicon.ico");
      expect(defaults).toContain("/assets/media/favicon-32.png");
    }
  });
});

describe("renderTemplates — standalone mode", () => {
  it("pins @originloom/* deps to the given version range, never workspace:*", () => {
    const pkg = JSON.parse(standalone({ version: "^1.2.0" })["package.json"]);
    expect(pkg.dependencies["@originloom/core"]).toBe("^1.2.0");
    expect(pkg.dependencies["@originloom/react"]).toBe("^1.2.0");
    expect(pkg.dependencies.hono).toBe("^4.12.34");
    expect(pkg.devDependencies["@originloom/tooling"]).toBe("^1.2.0");
    const specs = [
      pkg.dependencies["@originloom/core"],
      pkg.dependencies["@originloom/react"],
      pkg.devDependencies["@originloom/tooling"],
    ];
    expect(specs).not.toContain("workspace:*");
  });

  it("approves native builds and scopes the unsupported uuid escape hatch", () => {
    // A standalone repo is its own pnpm root, so it must list these itself —
    // otherwise `pnpm install` warns about ignored build scripts.
    const files = standalone();
    const pkg = JSON.parse(files["package.json"]);
    expect(files["pnpm-workspace.yaml"]).toContain("allowBuilds:");
    for (const dependency of [
      "esbuild",
      "sharp",
      "libxmljs2",
      "@tailwindcss/oxide",
      "protobufjs",
      "unrs-resolver",
    ]) {
      expect(files["pnpm-workspace.yaml"]).toContain(dependency);
    }
    for (const [selector, version] of Object.entries(PNPM_DEPENDENCY_OVERRIDES)) {
      expect(files["pnpm-workspace.yaml"]).toContain(`${selector}: ${version}`);
    }
    expect(pkg.packageManager).toBe("pnpm@11.18.0");
    expect(pkg.devDependencies["@napi-rs/wasm-runtime"]).toBe("1.1.6");
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
    expect(css).toContain("@view-transition");
    expect(css).toContain("bg-slate-50");
  });

  it("builds self-contained from the app root", () => {
    const dockerfile = standalone({ name: "demo-web" })["Dockerfile"];
    expect(dockerfile).toContain("docker build -t demo-web .");
    expect(dockerfile).toContain("COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist");
    expect(dockerfile).toContain("COPY --from=builder --chown=nodejs:nodejs /app/public ./public");
    expect(dockerfile).toContain("RUN pnpm typecheck && pnpm build");
    expect(dockerfile).not.toContain("pnpm-workspace.yaml");
    expect(dockerfile).not.toContain("--filter");
  });

  it("documents the standalone install/dev/deploy flow", () => {
    const readme = standalone({ name: "demo-web" })["README.md"];
    expect(readme).toContain("pnpm dev");
    expect(readme).toContain("pnpm ci");
    expect(readme).toContain("docs/routing.md");
    expect(readme).toContain("/legacy-catalog");
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
    expect(workspace()).not.toHaveProperty(["pnpm-workspace.yaml"]);
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
    expect(pkg.scripts.test).toBe("vitest run tests");
    expect(pkg.scripts.format).toBe("prettier --write .");
    expect(pkg.engines.node).toBe(">=22.19.0");
    expect(pkg.devDependencies["@eslint/js"]).toBe("^10.0.1");
    expect(pkg.devDependencies.eslint).toBe("^10.8.0");
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

describe("renderTemplates — browser E2E", () => {
  it("ships a production Playwright suite only for React", () => {
    const files = standalone();
    const pkg = JSON.parse(files["package.json"]);

    for (const path of [
      "playwright.config.ts",
      "e2e/critical-paths.spec.ts",
      "e2e/accessibility.spec.ts",
      "e2e/ssr.no-js.spec.ts",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
    expect(pkg.devDependencies["@playwright/test"]).toBe("^1.62.0");
    expect(pkg.devDependencies["@axe-core/playwright"]).toBe("^4.12.1");
    expect(pkg.scripts.e2e).toBe("playwright test");
    expect(pkg.scripts.ci).toContain("pnpm run e2e");
    expect(files["playwright.config.ts"]).toContain('command: "pnpm run e2e:server"');
    expect(files["playwright.config.ts"]).toContain("javaScriptEnabled: false");
    expect(files["tsconfig.json"]).toContain('"e2e"');
  });

  it("covers the platform's critical browser boundaries", () => {
    const files = standalone();
    const critical = files["e2e/critical-paths.spec.ts"];

    expect(critical).toContain("content-security-policy");
    expect(critical).toContain("/api/internal/client-errors");
    expect(critical).toContain("/api/internal/refresh");
    expect(critical).toContain("/old-catalog?source=e2e");
    expect(critical).toContain("/products/konut-avantaj?source=e2e");
    expect(critical).toContain("app_live_stream_active_connections");
    expect(critical).toContain('page.getByTestId("api-fetched-at")');
    expect(critical).toContain('headers()["x-cache"]).toBe("BYPASS")');
    expect(critical).toContain("Oturum bilgisi şu an alınamıyor.");
    expect(files["e2e/accessibility.spec.ts"]).toContain("AxeBuilder");
    expect(files["e2e/ssr.no-js.spec.ts"]).toContain("JavaScript is disabled");
  });

  it("installs Chromium and retains the HTML report in generated CI", () => {
    const files = standalone();
    const workflow = files[".github/workflows/ci.yml"];
    const pkg = JSON.parse(files["package.json"]);
    expect(workflow).toContain("pnpm run e2e:install");
    expect(pkg.scripts["e2e:install"]).toContain("playwright install --with-deps chromium");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("playwright-report/");
  });

  it("ships all example route files and registers them", () => {
    const files = standalone();
    for (const path of [
      "server/routes/catalog.tsx",
      "server/routes/data-cache.tsx",
      "server/routes/item-detail.tsx",
      "server/routes/account.tsx",
      "server/routes/live.tsx",
      "server/services/items.ts",
      "server/services/featured-items.ts",
      "server/services/live-message.ts",
      "server/api/index.ts",
      "src/features/catalog/catalog-page.tsx",
      "src/features/data-cache/data-cache-page.tsx",
      "src/features/items/item-detail-page.tsx",
      "src/features/live/live-page.tsx",
      "src/islands/account-panel.tsx",
      "src/islands/live-ticks.tsx",
      "src/lib/pagination.ts",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
    const routeTable = files["server/routes/index.ts"];
    for (const id of ["catalog", "dataCache", "itemDetail", "account", "live"]) {
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

  it("demonstrates cached API data inside an uncached HTML route", () => {
    const files = standalone();
    const route = files["server/routes/data-cache.tsx"];
    const service = files["server/services/featured-items.ts"];

    expect(route).toContain('path: "/data-cache"');
    expect(route).toContain("cache: neverCache");
    expect(route).toContain("getFeaturedItems(ctx.request)");
    expect(service).toContain('FEATURED_ITEMS_CACHE_KEY = "items:featured:v1"');
    expect(service).toContain('cacheStatus: "miss"');
    expect(service).toContain('hit.state === "stale"');
    expect(files["tests/featured-items-cache.test.ts"]).toContain("coalesces background refreshes");
    expect(files[".env.development"]).toContain("FEATURED_ITEMS_CACHE_TTL=10");
    expect(files[".env.development"]).toContain("FEATURED_ITEMS_CACHE_SWR=30");
  });

  it("wires streaming + SSE: streaming route, Suspense, EventSource island, /api/ticks mount", () => {
    const files = standalone();
    const route = files["server/routes/live.tsx"];
    expect(route).toContain("streaming: true");
    expect(route).toContain("getLiveMessage(ctx.request)");
    expect(route).not.toContain("setTimeout");
    expect(files["server/services/live-message.ts"]).toContain(
      'gatewayFetchWithIdentity(request, "/live/message")',
    );
    expect(files["server/services/live-message.ts"]).toContain("GatewayContracts.liveMessage");
    expect(files["mock-gateway/server.mjs"]).toContain('url.pathname === "/live/message"');
    expect(files["mock-gateway/server.mjs"]).toContain("MOCK_LIVE_MESSAGE_DELAY_MS");
    expect(files["tests/live-message-service.test.ts"]).toContain("rejects an invalid payload");
    expect(files["src/features/live/live-page.tsx"]).toContain("Suspense");
    expect(files["src/islands/live-ticks.tsx"]).toContain("new EventSource");
    expect(files["server/api/index.ts"]).toContain("mountLiveStreamApi");
    expect(files["server/api/live-stream/index.ts"]).toContain('"/api/ticks"');
    expect(files["server/api/live-stream/index.ts"]).toContain("x-accel-buffering");
    expect(files["server/api/live-stream/index.ts"]).toContain("stream.onAbort");
    expect(files["server/api/live-stream/admission.ts"]).toContain("perIpLimit");
    expect(files["server/index.ts"]).toContain("mounts: { api: mountApi, seo: mountSeo }");
  });
});

describe("renderTemplates — generated apps satisfy their own tooling", () => {
  const modes = [["react", renderTemplates({ ...base, mode: "workspace", version: "^0.1.0" })]];

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

describe("renderTemplates — gateway wiring", () => {
  const modes = [["react", renderTemplates({ ...base, mode: "workspace", version: "^0.1.0" })]];

  it.each(modes)("%s: fetches its data through the gateway, not from memory", (_name, files) => {
    const service = files["server/services/items.ts"];
    expect(service).toContain("gatewayFetch");
    // Untrusted JSON: bounded read against a contract, then a runtime guard.
    expect(service).toContain("readGatewayJson");
    expect(service).toContain("requireGatewayPayload");
    expect(service).not.toContain("const ITEMS");
  });

  it.each(modes)("%s: declares its own gateway contract", (_name, files) => {
    const contracts = files["server/services/gateway-contracts.ts"];
    expect(contracts).toContain("defineGatewayContract");
    // The name is the app's, not one borrowed from another product.
    expect(contracts).toContain('defineGatewayContract("items"');
  });

  it.each(modes)("%s: ships a mock gateway and starts it in dev and smoke", (_name, files) => {
    const gateway = files["mock-gateway/server.mjs"];
    expect(gateway).toContain("/items");
    expect(gateway).toContain("process.env.MOCK_GATEWAY_PORT ?? 4002");
    expect(gateway).not.toContain("process.env.PORT ?? 4002");
    expect(files[".env.development"]).toContain("MOCK_GATEWAY_PORT=4002");
    const scripts = JSON.parse(files["package.json"]).scripts;
    // `dev` runs the app and Vite and nothing else: a gateway is usually someone
    // else's process by the time anyone is developing against it. The bundled
    // mock is one command away, and the first-run instructions name that one.
    expect(scripts.dev).toBe("origin-dev");
    expect(scripts["dev:mock"]).toContain("--gateway mock-gateway/server.mjs");
    expect(scripts["mock-gw"]).toContain("mock-gateway/server.mjs");
    expect(scripts.smoke).toContain("--gateway mock-gateway/server.mjs");
  });

  it.each(modes)(
    "%s: shows a middleware value that varies the cache and one that must not",
    (_name, files) => {
      const middleware = files["server/middleware/experiments.ts"];
      // The platform's subtlest mechanism, and the one whose failure is silent:
      // forget cacheVary and the first visitor to miss the cache decides what
      // everybody sees for the whole TTL.
      expect(middleware).toContain("values");
      expect(middleware).toContain("cacheVary");
      // The bucket is read where it renders, which is what makes the vary required.
      expect(files["server/routes/catalog.tsx"]).toContain("ctx.values?.variant");
      // And a test that puts two buckets through the app rather than trusting the
      // middleware's return value.
      expect(files["tests/experiment-cache.test.ts"]).toContain("serves each bucket its own page");
      expect(files["docs/middleware.md"]).toContain("Unutmanın bedeli neden sessiz");
      // Off by default: a dimension nobody uses still doubles every entry of
      // every page that reads it.
      expect(files["server/middleware/index.ts"]).not.toMatch(/^\s*experimentsMiddleware,$/m);
    },
  );

  it.each(modes)(
    "%s: wires the dataLayer chain instead of computing pageMeta and dropping it",
    (_name, files) => {
      const analytics = files["server/product/analytics.ts"];
      // Only the sequence itself: the import block is sorted alphabetically and
      // says nothing about the order the steps run in.
      const chain = analytics.slice(analytics.indexOf("sequencedScript("));
      // Consent first, then the visitor's own id, then the queue — which has to be
      // installed before the container because it wraps `dataLayer.push`.
      expect(chain.indexOf("trackingIdPushScript")).toBeGreaterThan(
        chain.indexOf("src: consentUrl"),
      );
      expect(chain.indexOf("eventQueueScript")).toBeGreaterThan(
        chain.indexOf("trackingIdPushScript"),
      );
      expect(chain.indexOf("gtmContainerUrl")).toBeGreaterThan(chain.indexOf("eventQueueScript"));
      // The chain was dead before: every route computed pageMeta and RootLayout
      // took the prop and ignored it.
      expect(files["src/components/layout/root-layout.tsx"]).toContain('name="page-analytics"');
      expect(files["server/index.ts"]).toContain('eagerIslands: ["page-analytics"]');
      expect(files["tests/analytics-chain.test.ts"]).toContain(
        "reads the tracking id in the browser rather than rendering it",
      );
      expect(files["docs/analytics.md"]).toContain("gtm.load");
      // Nothing waits for a consent event. A returning visitor's decision is
      // already known and a first visit's is not, so waiting made the same site
      // produce one order in a normal window and another in an incognito one.
      expect(files["server/product/analytics.ts"]).not.toContain("awaitDataLayerEvent");
      expect(files["docs/analytics.md"]).toContain("Neden hiçbir consent olayı beklenmiyor");
      // And the only test that can actually answer "is the order right": a real
      // browser, reading window.dataLayer, with a fresh context and a returning
      // one asserted to produce the same sequence.
      expect(files["e2e/analytics.spec.ts"]).toContain(
        "builds in one order, whatever the visitor arrived with",
      );
      expect(files["playwright.config.ts"]).toContain("EFILLI_SCRIPT_URL");
    },
  );

  it.each(modes)("%s: declares its cache dimensions in one place, device only", (_name, files) => {
    const keys = files["src/lib/cache-keys.ts"];
    // A dimension multiplies the entries of every page that uses it, so adding
    // or removing one has to be a single edit rather than eight.
    expect(keys).toContain("function sharedDimensions(ctx: Ctx): string[]");
    expect(keys).toContain("...sharedDimensions(ctx)");
    // Locale is out: i18n was removed, and splitting on Accept-Language stored
    // byte-identical HTML twice.
    expect(keys).not.toContain("locale(ctx.request),");
    expect(files["docs/caching.md"]).toContain("Cache key boyutları");
  });

  it.each(modes)("%s: proves one visitor's identity cannot reach another", (_name, files) => {
    const test = files["tests/tracking-id-leak.test.ts"];
    // Three independent reasons, asserted separately because any one of them
    // could be undone by an ordinary-looking change.
    expect(test).toContain("never puts the tracking id in the HTML");
    expect(test).toContain("does not hand the first visitor's id to the second");
    expect(test).toContain("still mints a new visitor their own cookie on a cache hit");
    expect(files["docs/caching.md"]).toContain("Cache'lenen şey nedir: yalnız gövde");
  });

  it.each(modes)("%s: ships a webhook that verifies, bounds and de-duplicates", (_name, files) => {
    const api = files["server/api/webhooks.ts"];
    // The signature covers the raw body: verifying a re-serialized object checks
    // this app's JSON encoder rather than the sender.
    expect(api).toContain("createHmac");
    expect(api).toContain("timingSafeEqual");
    expect(api).toContain("REPLAY_WINDOW_MS");
    expect(api).toContain("MAX_BODY_BYTES");
    // A retry processed twice is a duplicate payment.
    expect(api).toContain("already-seen");
    // No secret, no deliveries.
    expect(api).toContain('refuse(503, "not_configured")');
    expect(files["docs/webhooks.md"]).toContain("ham gövde");
  });

  it.each(modes)("%s: shows what the app sent, without showing its credentials", (_name, files) => {
    const gateway = files["mock-gateway/server.mjs"];
    // Reading the identity off a real request is how you check it yourself.
    expect(gateway).toContain("logRequest(req, url)");
    expect(gateway).toContain("MOCK_GW_HEADERS");
    // A terminal scrollback and a screenshot are both places a token must not be.
    expect(gateway).toContain('REDACTED_HEADERS = new Set(["authorization", "cookie"');
    expect(files["docs/configuration.md"]).toContain("MOCK_GW_HEADERS=1");
  });

  it.each(modes)("%s: keeps the operations listener out of development", (_name, files) => {
    // Two ports for one dev command is one more chance to collide with the next
    // project — and a laptop rarely needs /metrics.
    expect(files["server/index.ts"]).toContain("if (config.metricsEnabled) {");
    expect(files["docs/configuration.md"]).toContain("METRICS_ENABLED");
  });

  it.each(modes)("%s: hands the loader's gateway call the whole request", (_name, files) => {
    // The request carries both halves of what an upstream call needs: the abort
    // signal, so a cancelled request does not keep it alive, and the identity
    // the gateway is given on every call.
    expect(files["server/routes/catalog.tsx"]).toContain(
      "listItems(catalogSearch(ctx.url, productConfig.catalogPageSize), ctx.request)",
    );
    expect(files["server/services/items.ts"]).toContain("gatewayFetchWithIdentity");
  });

  it("react: configures and drains the bounded gateway transport", () => {
    const files = standalone();
    expect(files["server/index.ts"]).toContain("closeGatewayTransport()");
    expect(files["server/index.ts"].indexOf("closeGatewayTransport()")).toBeGreaterThan(
      files["server/index.ts"].indexOf("drainBotAnalytics()"),
    );
    expect(files["server/services/menu.ts"]).toContain("memoizeRequestValue");
    expect(files["server/services/items.ts"]).toContain("requireGatewayOk");
    expect(files[".env.production"]).toContain("GATEWAY_MAX_CONNECTIONS=64");
    expect(files[".env.production"]).toContain("GATEWAY_CONNECT_TIMEOUT_MS=1000");
  });

  it("react: documents log sampling, precompression and CDN delivery", () => {
    const files = standalone();
    expect(files[".env.production"]).toContain("REQUEST_LOG_SAMPLE_RATE=0.1");
    expect(files[".env.production"]).toContain("HTTP_COMPRESSION_THRESHOLD_BYTES=1024");
    expect(files["docs/runtime-performance.md"]).toContain("Gateway bağlantı yönetimi");
    expect(files["docs/runtime-performance.md"]).toContain("Compression stratejisi");
    expect(files["docs/runtime-performance.md"]).toContain("Static asset ve CDN teslimi");
  });
});

describe("renderTemplates — SEO, cache purge and product metrics", () => {
  const modes = [["react", renderTemplates({ ...base, mode: "workspace", version: "^0.1.0" })]];

  it.each(modes)("%s: serves robots.txt and a sitemap the gateway defines", (_name, files) => {
    expect(files["server/index.ts"]).toContain("seo: mountSeo");
    const seo = files["server/seo.ts"];
    expect(seo).toContain("mountSeoRoutes");
    // Asked, not derived: a sitemap built from one page of a catalogue silently
    // omits the rest of the site once the catalogue outgrows that page.
    expect(seo).toContain("fetchSitemapEntries");
    expect(seo).toContain("fallbackEntries");
    // And what comes back is a public path on this site or it is refused.
    expect(files["server/services/sitemap.ts"]).toContain('!value.startsWith("//")');
    expect(files["mock-gateway/server.mjs"]).toContain('url.pathname === "/seo/sitemap"');
  });

  it.each(modes)("%s: keeps cache purge off the public listener", (_name, files) => {
    // Reachable from the internet, it would be a denial-of-service lever even
    // behind a secret; the operations port is not exposed.
    expect(files["server/api/index.ts"]).not.toContain("mountCachePurgeApi");
    expect(files["server/index.ts"]).toContain("mountCachePurgeApi");
    expect(files["server/index.ts"]).toContain("createMetricsApp({");
  });

  it.each(modes)("%s: appends its own metrics to /metrics", (_name, files) => {
    expect(files["server/product/runtime.ts"]).toContain("catalogMetricLines");
    const metrics = files["server/metrics/catalog.ts"];
    expect(metrics).toContain("counterLines");
    // Unbounded label values are how a metric takes Prometheus down.
    expect(metrics).toContain("bucket");
  });
});

describe("renderTemplates — production reference coverage", () => {
  it("ships human-readable feature documentation for React apps", () => {
    const files = standalone();
    for (const path of [
      "docs/features.md",
      "docs/auth.md",
      "docs/background-workers.md",
      "docs/caching.md",
      "docs/capacity.md",
      "docs/configuration.md",
      "docs/dynamic-shell.md",
      "docs/routing.md",
      "docs/streaming.md",
      "docs/seo.md",
      "docs/observability.md",
      "docs/react-query.md",
      "docs/testing.md",
      "docs/contracts.md",
      "docs/performance.md",
      "docs/performance-acceptance.md",
      "docs/runtime-performance.md",
      "docs/upgrading.md",
    ]) {
      expect(files, `missing ${path}`).toHaveProperty([path]);
    }
    expect(files["README.md"]).toContain("docs/features.md");
    expect(files["docs/runtime-performance.md"]).toContain("Cache-hit hızlı yolu");
    expect(files["docs/features.md"]).toContain("runtime-performance.md");
  });

  it("ships contract drift and frontend quality gates", () => {
    const files = standalone();
    const pkg = JSON.parse(files["package.json"]);
    const contracts = JSON.parse(files["contracts/gateway-contracts.json"]);
    expect(files).toHaveProperty(["contracts/openapi.json"]);
    expect(files).toHaveProperty(["contracts/gateway-contracts.json"]);
    expect(files).toHaveProperty(["performance-budgets.json"]);
    expect(files).toHaveProperty(["lighthouserc.json"]);
    expect(files).toHaveProperty([".github/workflows/contract-staging.yml"]);
    expect(pkg.scripts["contracts:fixtures"]).toBe("origin-check-contracts");
    expect(pkg.scripts["contracts:scaffold"]).toBe("origin-scaffold-gateway");
    expect(pkg.scripts["budget:bundle"]).toBe("origin-check-budgets");
    expect(pkg.scripts.lighthouse).toBe("origin-lighthouse");
    expect(pkg.devDependencies.lighthouse).toBe("^13.4.1");
    expect(pkg.devDependencies).not.toHaveProperty("@lhci/cli");
    expect(contracts.schemaVersion).toBe(2);
    expect(contracts.contracts[0]).toMatchObject({
      operationId: "catalog.list",
      request: { method: "GET", path: "/items?category=all&sortBy=recommended&page=1&perPage=3" },
      response: {
        status: 200,
        contentType: "application/json",
        fixture: "fixtures/items-page.json",
        schema: "#/components/schemas/ItemPage",
      },
    });
    expect(contracts.contracts).toContainEqual(
      expect.objectContaining({
        id: "live-message",
        operationId: "live.message",
        request: { method: "GET", path: "/live/message" },
        response: expect.objectContaining({
          fixture: "fixtures/live-message.json",
          schema: "#/components/schemas/LiveMessage",
        }),
      }),
    );
    expect(files).toHaveProperty(["contracts/fixtures/live-message.json"]);
    expect(pkg.scripts.ci).toContain("contracts:fixtures");
    expect(pkg.scripts.ci).toContain("budget:bundle");
    expect(pkg.scripts.ci).toContain("lighthouse");
  });

  it("ships the full capacity runner in every React project", () => {
    const files = standalone();
    const pkg = JSON.parse(files["package.json"]);

    expect(files).toHaveProperty(["load-test/capacity.mjs"]);
    expect(files).toHaveProperty(["load-test/capacity-metrics.mjs"]);
    expect(files).toHaveProperty(["load-test/capacity-report.mjs"]);
    expect(files).toHaveProperty(["load-test/capacity-scenarios.mjs"]);
    expect(files).toHaveProperty(["load-test/performance-policy.mjs"]);
    expect(files).toHaveProperty(["load-test/performance.mjs"]);
    expect(files).toHaveProperty(["load-test/profile.mjs"]);
    expect(files).toHaveProperty(["load-test/profile-target.mjs"]);
    expect(files).toHaveProperty(["performance-policy.json"]);
    expect(pkg.scripts.capacity).toBe("node load-test/capacity.mjs");
    expect(pkg.scripts["capacity:quick"]).toContain("--profile quick");
    expect(pkg.scripts["capacity:profile"]).toContain("profile.mjs");
    expect(pkg.scripts["performance:compare"]).toContain("performance.mjs");
    expect(pkg.scripts["performance:accept"]).toContain("--accept");
    expect(pkg.devDependencies.autocannon).toBe("^8.0.0");
    for (const [selector, version] of Object.entries(PNPM_DEPENDENCY_OVERRIDES)) {
      expect(files["pnpm-workspace.yaml"]).toContain(`${selector}: ${version}`);
    }
    expect(files["docs/capacity.md"]).toContain("10 → 25 → 50 → 100 → 200 → 400");
    expect(files[".gitignore"]).toContain("load-test/reports/");
  });

  it("ships a native CycloneDX and Dependency-Track workflow", () => {
    const files = standalone({ name: "payments-web" });
    const pkg = JSON.parse(files["package.json"]);
    const config = JSON.parse(files["dependency-track.config.json"]);

    expect(pkg.version).toBe("0.1.0");
    expect(pkg.packageManager).toBe("pnpm@11.18.0");
    expect(pkg.scripts.sbom).toBe("origin-sbom");
    expect(pkg.scripts["audit:prod"]).toBe("origin-audit");
    expect(pkg.scripts["dependency-track:publish"]).toContain("origin-dependency-track");
    expect(config).toMatchObject({
      projectName: "payments-web",
      bomPath: "artifacts/sbom/bom.cdx.json",
      gate: { failOnSeverity: "critical", failOnPolicyViolation: "fail" },
    });
    expect(files).toHaveProperty(["docs/supply-chain-security.md"]);
    expect(files[".github/workflows/dependency-track.yml"]).toContain("DEPENDENCY_TRACK_API_KEY");
    expect(files[".github/workflows/dependency-track.yml"]).toContain("pnpm run sbom");
    expect(files[".gitignore"]).toContain("artifacts/sbom/");
  });

  it("scaffolds npm standalone without pnpm-workspace.yaml", () => {
    const files = standalone({ name: "npm-web", packageManager: "npm" });
    const pkg = JSON.parse(files["package.json"]);
    expect(files).not.toHaveProperty(["pnpm-workspace.yaml"]);
    expect(pkg.packageManager).toBe("npm@11.18.0");
    expect(pkg.overrides).toEqual(PNPM_DEPENDENCY_OVERRIDES);
    expect(pkg.onlyBuiltDependencies).toContain("sharp");
    expect(pkg.scripts.ci).toContain("npm run origin:doctor -- --strict");
    expect(files[".github/workflows/ci.yml"]).toContain("npm ci");
    expect(files["Dockerfile"]).toContain("package-lock.json");
  });

  it("scaffolds yarn standalone with berry config", () => {
    const files = standalone({ name: "yarn-web", packageManager: "yarn" });
    const pkg = JSON.parse(files["package.json"]);
    expect(files).not.toHaveProperty(["pnpm-workspace.yaml"]);
    expect(files[".yarnrc.yml"]).toContain("nodeLinker: node-modules");
    expect(pkg.packageManager).toBe("yarn@4.9.2");
    expect(pkg.resolutions).toEqual(YARN_RESOLUTIONS);
    expect(files[".github/workflows/ci.yml"]).toContain("yarn install --immutable");
    expect(files["Dockerfile"]).toContain("yarn.lock");
  });

  it("records template provenance and makes upgrade health part of CI", () => {
    const files = standalone({ version: "^9.8.7", templateVersion: "9.9.0" });
    const metadata = JSON.parse(files[".originloom/project.json"]);
    const pkg = JSON.parse(files["package.json"]);

    expect(metadata).toMatchObject({
      schemaVersion: 2,
      templateVersion: "9.9.0",
      platformRange: "^9.8.7",
      renderer: "react",
      mode: "standalone",
      packageManager: "pnpm",
      generatedBy: "@originloom/tooling",
      plugins: [],
    });
    expect(metadata.appliedMigrations).toContain("0.5.14-upgrade-contract-v1");
    expect(metadata.appliedMigrations).toContain("0.5.17-eslint-10");
    expect(metadata.appliedMigrations).toContain("0.5.18-vitest-scope");
    expect(pkg.scripts["origin:doctor"]).toBe("origin-doctor");
    expect(pkg.scripts["origin:migrate"]).toBe("origin-migrate");
    expect(pkg.scripts.ci).toContain("origin:doctor --strict");
    expect(files["docs/upgrading.md"]).toContain("origin:migrate --apply");
  });

  it("aligns the BFF refresh endpoint with the query-backed clientApiFetch hook", () => {
    const files = standalone();
    expect(files["server/api/session.ts"]).toContain('"/api/internal/refresh"');
    expect(files["src/islands/account-panel.tsx"]).toContain("useSessionQuery");
    expect(files["src/lib/query/hooks/use-session.ts"]).toContain("clientApiFetch");
    expect(files["tests/auth-client.test.ts"]).toContain('"/api/internal/refresh"');
  });

  it("ships a bounded mock refresh contract and documents its development cookies", () => {
    const files = standalone();
    const gateway = files["mock-gateway/server.mjs"];
    expect(gateway).toContain('url.pathname === "/auth/refresh"');
    expect(gateway).toContain('body.refreshToken !== "dev-refresh-token"');
    expect(gateway).toContain("createDevAccessToken()");
    expect(gateway).toContain("bytes > 16_384");
    expect(files["docs/auth.md"]).toContain("access_token=");
    expect(files["docs/auth.md"]).toContain("refresh_token=dev-refresh-token");
    expect(files["docs/auth.md"]).toContain("HttpOnly");
  });

  it("loads TanStack Query only with the island that uses it", () => {
    const files = standalone();
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.dependencies["@tanstack/react-query"]).toBe("^5.101.4");
    expect(files["src/hydrate.client.tsx"]).not.toContain("AppQueryProvider");
    expect(files["src/islands/account-panel.tsx"]).toContain(
      'import { AppQueryProvider } from "@originloom/react/lib/query/provider"',
    );
    expect(files["src/islands/account-panel.tsx"]).toContain("<AppQueryProvider>");
    expect(files["src/lib/query/keys.ts"]).toContain('["session", "current"]');
    expect(files["docs/react-query.md"]).toContain("React Query'yi tamamen kaldırma");
  });

  it("defers Web Vitals without delaying first paint or island hydration", () => {
    const entry = standalone()["src/entry.client.tsx"];

    expect(entry).toContain('import("web-vitals")');
    expect(entry).toContain("requestIdleCallback");
    expect(entry).not.toContain('from "web-vitals"');
  });

  it("normalizes content query params before they enter a cache key", () => {
    const files = standalone();
    expect(files["src/lib/cache-keys.ts"]).toContain("contentQueryCacheFragment");
    // The registry and the loader must read one contract, not two copies of it:
    // otherwise ?sortBy=newest can be served the cached HTML of ?sortBy=recommended.
    expect(files["src/lib/cache-keys.ts"]).toContain("include: [...CATALOG_QUERY]");
    expect(files["src/lib/cache-keys.ts"]).toContain("normalize: catalogNormalizers");
    expect(files["tests/catalog-query.test.ts"]).toContain("expect(contentQuery?.normalize).toBe(");
  });

  it("ships a list page that separates a bad URL from a defaulted one", () => {
    const route = standalone()["server/routes/catalog.tsx"];
    // Clamping ?page=abc to page 1 is the tempting shortcut, and it serves the
    // catalogue under infinitely many addresses.
    expect(route).toContain("resolvePageParam");
    expect(route).toContain("return notFound()");
    expect(route).toContain("308");
    // A URL heading for a 404 or a redirect must not take a cache entry with it.
    expect(route).toContain("pageCache(PageCacheId.catalog, (ctx) =>");
  });

  it("validates a route param against values the gateway owns", () => {
    const files = standalone();
    expect(files["server/routes/catalog-category.tsx"]).toContain("validateParams");
    expect(files["server/routes/catalog-category.tsx"]).toContain("isKnownCategory");
    // The snapshot is shared-cached because validateParams runs before the page
    // cache — on hits as well as misses.
    expect(files["server/services/route-domains.ts"]).toContain("cache.read(key)");
    expect(files["mock-gateway/server.mjs"]).toContain('url.pathname === "/routing/domains"');
  });

  it("keeps the cache purge endpoints off the public site", () => {
    const files = standalone();
    // Emptying the cache points the whole fleet at the gateway; that button does
    // not belong on a port the internet can reach.
    expect(files["server/index.ts"]).toContain(
      "createMetricsApp({ mounts: (app) => mountCachePurgeApi(app) })",
    );
    expect(files["server/api/index.ts"]).not.toContain("mountCachePurgeApi");
    expect(files["tests/cache-purge.test.ts"]).toContain("is not reachable from the public site");
  });

  it("ships bounded live-stream lifecycle, metrics and tests", () => {
    const files = standalone();
    expect(files["server/api/live-stream/index.ts"]).toContain("liveStreamMaxConnections");
    expect(files["server/api/live-stream/index.ts"]).toContain("stopLiveStreams");
    expect(files["server/metrics/live-stream.ts"]).toContain("active_connections");
    expect(files["server/product/runtime.ts"]).toContain("liveStreamMetricLines");
    expect(files["tests/live-stream-admission.test.ts"]).toContain("global_limit");
    expect(files[".env.production"]).toContain("LIVE_STREAM_MAX_CONNECTIONS=1000");
  });

  it("builds the menu on the platform's own contract, cached per device", () => {
    const files = standalone();
    const service = files["server/services/menu.ts"];
    // The platform ships a menu contract — header/hamburger/footer, nested,
    // ordered per device. A flat {label,href} of one's own throws all of it away.
    expect(files["src/lib/menu.ts"]).toContain('from "@originloom/shared/lib/menu/types"');
    expect(service).toContain("parseGatewayPayload");
    expect(service).toContain("normalizeNavigationUrl");
    // Device is part of the key because it is part of the answer.
    expect(service).toContain("menuCacheKey(device)");
    expect(service).toContain('headers: { "content-type": "application/json", device }');
    expect(service).toContain("EMPTY_MENU");
    expect(files["server/services/shell-data.ts"]).toContain(
      "getMenu(ctx.request, base.deviceType)",
    );
    expect(files["src/components/layout/root-layout.tsx"]).toContain("shell.menu.headerItems");
    expect(files["src/components/layout/root-layout.tsx"]).toContain("shell.menu.footerItems");
    // A submenu that only opens on hover cannot be reached with a keyboard.
    expect(files["src/components/layout/root-layout.tsx"]).toContain("group-focus-within");
    expect(files["tests/menu-cache.test.ts"]).toContain("one entry per device");
    expect(files[".env.production"]).toContain("MENU_CACHE_TTL=14400");
    expect(files[".env.production"]).toContain("FEATURED_ITEMS_CACHE_TTL=10");
  });

  it("documents production cache decisions, operations and failure modes", () => {
    const files = standalone();
    const guide = files["docs/caching.md"];

    expect(guide).toContain("## TTL ve SWR nasıl seçilir?");
    expect(guide).toContain("## Request yaşam döngüsü ve stampede koruması");
    expect(guide).toContain("CACHE_FILL_WAIT_MS");
    expect(guide).toContain("CACHE_REQUIRED=true");
    expect(guide).toContain('{"pageIds":["catalog"]}');
    expect(guide).toContain('{"prefix":"menu:"}');
    expect(guide).toContain('{"prefix":"items:featured:"}');
    expect(guide).toContain("Cache'siz HTML içinde cache'li public API verisi");
    expect(guide).toContain("keysEncoded");
    expect(guide).toContain("ssr_cache_l2_healthy");
    expect(guide).toContain("## Deploy ve içerik değişikliği runbook'u");

    const skill = files[".claude/skills/caching/SKILL.md"];
    expect(skill).toContain('{"pageIds":["catalog"]}');
    expect(skill).not.toContain('{"mode":"prefix"');
  });

  it("wires a bounded bot analytics worker into runtime and shutdown", () => {
    const files = standalone();
    expect(files["server/services/bot-analytics.ts"]).toContain("class BotAnalyticsQueue");
    expect(files["server/product/runtime.ts"]).toContain("onBotVisit: storeBotVisit");
    expect(files["server/index.ts"]).toContain("drainBotAnalytics");
    expect(files["tests/bot-analytics.test.ts"]).toContain("queue_full");
  });

  it("validates CMS SEO and emits paginated structured metadata", () => {
    const files = standalone();
    expect(files["server/services/items.ts"]).toContain("parseSeoInfo(value.seoInfo");
    expect(files["server/routes/catalog.tsx"]).toContain("itemListJsonLd");
    // Both pages take their copy from the CMS contract rather than assembling a
    // title by hand — that is what gets og:image and noindex set at all.
    expect(files["server/routes/catalog.tsx"]).toContain("generatePaginatedMetadata");
    expect(files["server/routes/item-detail.tsx"]).toContain("generateMetaDataForPageWithSeoInfo");
  });

  it("ships a quote whose inputs are part of the page, not of the visitor", () => {
    const files = standalone();
    // The amount and the term identify the page, so they belong in the key —
    // normalized first, or a slider becomes ten thousand cache entries.
    expect(files["src/lib/cache-keys.ts"]).toContain("include: [...QUOTE_QUERY]");
    expect(files["src/lib/cache-keys.ts"]).toContain("normalize: quoteNormalizers");
    // And the canonical stays the product's address: a quote is a view of one
    // page, not a page of its own.
    expect(files["server/routes/item-detail.tsx"]).toContain("canonical: url");
    expect(files["mock-gateway/server.mjs"]).toContain("requestedQuote");
  });

  it("ships a tool page whose first result comes from the server", () => {
    const files = standalone();
    // A calculator that only produces a number after hydration is a blank box to
    // a crawler and to anyone whose script did not load.
    expect(files["server/routes/calculator.tsx"]).toContain("getPaymentPlan");
    expect(files["src/islands/loan-calculator.tsx"]).toContain("initial");
    // `hydrate` means the server renders the island and the client wakes it up,
    // so the children must be the island itself. A hand-written second copy of
    // the markup is how a hydration mismatch starts (React #418).
    expect(files["server/routes/calculator.tsx"]).toContain("<LoanCalculator initial={data} />");
    // One implementation of the arithmetic: the island calls the same endpoint.
    expect(files["src/islands/loan-calculator.tsx"]).toContain("/api/calculator?");
    expect(files["server/api/calculator.ts"]).toContain("guardPublicApi");
  });

  it("ships an outbound hand-off that is a write, not a link", () => {
    const files = standalone();
    const api = files["server/api/referrals.ts"];
    // A GET would let a crawler or a prefetch record a hand-off nobody made.
    expect(api).toContain('app.post("/api/referrals"');
    expect(api).toContain("requireSameOriginMutation: true");
    // The provider's URL is untrusted input; following it blindly is an open
    // redirect with this site's name on it.
    expect(api).toContain("normalizeNavigationUrl");
    expect(api).toContain("httpOnly: true");
    expect(files["src/features/items/item-detail-page.tsx"]).toContain('method="post"');
  });

  it("ships an editorial page with the structured data only it may claim", () => {
    const files = standalone();
    expect(files["src/lib/metadata/jsonld-article.ts"]).toContain('"@type": "Article"');
    expect(files["src/lib/metadata/jsonld-article.ts"]).toContain('"@type": "FAQPage"');
    // An empty FAQPage claims the page answers questions it does not.
    expect(files["src/lib/metadata/jsonld-article.ts"]).toContain(
      "if (items.length === 0) return null",
    );
    expect(files["tests/guides.test.ts"]).toContain("makes no FAQ claim");
  });

  it("puts structured data under the field the platform actually reads", () => {
    const files = standalone();
    // `PageMetadata` has `structuredData` and no `jsonLd`. A route returning the
    // latter type-checks, renders, and ships a page with no breadcrumb on it.
    for (const route of ["server/routes/catalog.tsx", "server/routes/item-detail.tsx"]) {
      expect(files[route]).toContain("structuredData: compactJsonLd(");
      expect(files[route]).not.toContain("jsonLd: compactJsonLd(");
    }
    // And a test that reads the rendered HTML, so this cannot regress silently.
    expect(files["tests/detail-seo.test.ts"]).toContain("BreadcrumbList");
  });

  it("ships integration-level boundary tests for session, SSE and purge key transport", () => {
    const files = standalone();
    expect(files["tests/session-api.test.ts"]).toContain("/api/internal/refresh");
    expect(files["tests/live-stream-api.test.ts"]).toContain("cross-site");
    expect(files["tests/cache-key-codec.test.ts"]).toContain("encodeCacheKeyForApi");
  });

  it("ships working redirect, rewrite, explicit proxy and CMS gone examples", () => {
    const files = standalone();
    const rules = files["src/routing/rules.ts"];
    expect(rules).toContain('source: "/old-catalog"');
    expect(rules).toContain('source: "/products/:slug"');
    expect(rules).toContain('source: "/gateway/menu"');
    expect(files["tests/routing-rules.test.ts"]).toContain('publicPath: "/products/alpha"');
    expect(files["mock-gateway/server.mjs"]).toContain('"/cms/redirects"');
    expect(files["mock-gateway/server.mjs"]).toContain('"/removed-page", { type: "gone" }');
  });
});

describe("renderTemplates — product config, public API and media", () => {
  const modes = [["react", renderTemplates({ ...base, mode: "workspace", version: "^0.1.0" })]];

  it.each(modes)("%s: validates its own environment at startup", (_name, files) => {
    expect(files["server/index.ts"]).toContain("validateConfig([validateProductConfig])");
    const config = files["server/product/config.ts"];
    expect(config).toContain("assertPositiveInteger");
    // The example setting is used, not decorative.
    const route = files["server/routes/catalog.tsx"];
    expect(route).toContain("productConfig.catalogPageSize");
    expect(files[".env.development"]).toContain("CATALOG_PAGE_SIZE=3");
  });

  it.each(modes)("%s: guards its public endpoint", (_name, files) => {
    const api = files["server/api/items.ts"];
    expect(api).toContain("guardPublicApi");
    // Both a process-wide budget and a per-caller one; one without the other is
    // either trivially exhausted or trivially bypassed.
    expect(api).toContain("globalLimit");
    expect(api).toContain("ipLimit");
    expect(api).toContain("requireSameOriginMutation");
  });

  it.each(modes)("%s: ships a media pipeline with its own sources", (_name, files) => {
    const media = JSON.parse(files["server/media.config.json"]);
    expect(media.seoAssets.openGraphSource).toBe("src/assets/images/og-cover.svg");
    expect(files).toHaveProperty(["src/assets/images/og-cover.svg"]);
    expect(JSON.parse(files["package.json"]).scripts.media).toBe("origin-build-media");
  });

  it.each(modes)("%s: ships a public folder served under /public/*", (_name, files) => {
    expect(files).toHaveProperty(["public/README.md"]);
    expect(files).toHaveProperty(["public/test.img"]);
    expect(files["public/README.md"]).toContain("/public/*");
  });

  it("ships icon codegen with the transformer left in the tooling that runs it", () => {
    const [, react] = modes[0];
    expect(react).toHaveProperty([".svgrrc.cjs"]);
    expect(react[".svgrrc.cjs"]).toContain("convertStyleToAttrs");
    expect(JSON.parse(react["package.json"]).scripts.icons).toBe("origin-generate-icons");
    // The transformer belongs to the tooling that runs it. An app carrying its
    // own copy also carried @svgr/cli's deprecated glob chain for nothing.
    expect(JSON.parse(react["package.json"]).devDependencies["@svgr/cli"]).toBeUndefined();
  });
});
