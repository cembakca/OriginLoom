/**
 * Templates for `origin-create-app`.
 *
 * Every file here is app-owned by design. Anything generic — cache, middleware,
 * SSR pipeline, island runtime, metadata engine — stays in @originloom/core and
 * @originloom/react and is consumed, never copied.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderSkills } from "./skills.mjs";
import { renderOpsTemplates } from "./templates-ops.mjs";
import * as vanilla from "./templates-vanilla.mjs";

/** Dev-server port for the client bundle, derived from the app port (3010 → 5010). */
export const VITE_PORT_OFFSET = 2000;

/** Scoped registry for the platform packages; everything else stays on the default. */
const npmrc = (registry) => `@originloom:registry=${registry}\n`;

/** Reads a verbatim asset shipped alongside the generator (packed via files: ["bin"]). */
const asset = (name) =>
  readFileSync(fileURLToPath(new URL(`./assets/${name}`, import.meta.url)), "utf8");

/**
 * @param {{
 *   name: string;
 *   title: string;
 *   port: number;
 *   metricsPort: number;
 *   mode: "workspace" | "standalone";
 *   version: string;
 *   renderer?: "react" | "vanilla";
 *   vitePort?: number;
 *   registry?: string;
 * }} vars
 */
export function renderTemplates({
  name,
  title,
  port,
  metricsPort,
  mode,
  version,
  renderer = "react",
  vitePort = port + VITE_PORT_OFFSET,
  registry,
  withOps = false,
}) {
  // Standalone apps live in their own repo and depend on the published
  // @originloom/* packages; workspace apps sit in apps/<name> and link them
  // via workspace:*. The two modes differ only in how they reach the packages
  // and how they build — the app source they generate is identical.
  const standalone = mode === "standalone";
  // The renderer decides how HTML is produced, so it decides which route, page,
  // island and client-entry templates ship. Everything else is identical.
  if (renderer === "vanilla") {
    return vanillaTemplates({
      name,
      title,
      port,
      metricsPort,
      vitePort,
      standalone,
      version,
      registry,
      withOps,
    });
  }
  return {
    // npm config is not inherited from parent directories, so an app that
    // installs @originloom/* from somewhere other than npmjs carries its own.
    ...(registry ? { ".npmrc": npmrc(registry) } : {}),
    "package.json": packageJson(name, { standalone, version, withOps }),
    "tsconfig.json": tsconfig(standalone),
    "eslint.config.js": eslintConfig(),
    ".prettierrc.json": asset("prettierrc.json"),
    ".prettierignore": prettierIgnore(),
    "vite.config.ts": viteConfig(vitePort),
    "vite.server.config.ts": viteServerConfig(),
    "vitest.config.ts": vitestConfig(name),
    ".env.development": envDevelopment(name, port, metricsPort, vitePort),
    ".env.production": envProduction(port, metricsPort),
    "README.md": readme(name, title, port, vitePort, standalone),
    Dockerfile: dockerfile(name, port, standalone),
    ".dockerignore": asset("dockerignore"),
    ".gitignore": asset("gitignore"),
    ".nvmrc": asset("nvmrc"),
    ".editorconfig": asset("editorconfig"),
    ".github/workflows/ci.yml": githubWorkflow(name),
    // Opt-in deployment assets: compose, k8s manifests, a load generator.
    ...(withOps ? renderOpsTemplates({ name, port, metricsPort }) : {}),

    "server/index.ts": serverIndex("/src/entry.client.tsx"),
    "server/api/index.ts": apiIndex(),
    "server/seo.ts": seoRoutes(),
    "server/metrics/catalog.ts": productMetrics(),
    "server/product/config.ts": productConfigFile(),
    "server/product/analytics.ts": productAnalytics(),
    "server/api/items.ts": publicItemsApi(),
    "server/api/session.ts": sessionApi(),
    "server/media.config.json": mediaConfig(),
    "src/assets/images/og-cover.svg": ogCoverSvg(title),
    "src/assets/images/hero.svg": heroSvg(title),
    "src/assets/images/brand-mark.svg": brandMarkSvg(),
    // React icon codegen: src/assets/svg → src/components/icons (pnpm icons).
    ".svgrrc.cjs": svgrConfig(),
    "src/assets/svg/brand-mark.svg": brandMarkSvg(),
    "server/routes/index.ts": routesIndex(),
    "server/routes/home.tsx": homeRoute(title),
    "server/routes/showcase.tsx": showcaseRoute(),
    "server/routes/media.tsx": mediaRoute(),
    "src/features/media/media-page.tsx": mediaPage(),
    "server/routes/catalog.tsx": catalogRoute(),
    "server/routes/item-detail.tsx": itemDetailRoute(),
    "server/routes/account.tsx": accountRoute(),
    "server/routes/live.tsx": liveRoute(),
    "server/services/shell-data.ts": serverShellData(),
    "server/services/items.ts": itemsService(),
    "server/services/profile.ts": profileService(),
    "server/services/gateway-contracts.ts": gatewayContracts(),
    "mock-gateway/server.mjs": mockGateway(),
    "server/product/runtime.ts": productRuntime(),
    "server/product/document-shell.ts": productDocumentShell(title),
    "server/product/renderer.tsx": productRenderer(),
    "server/product/boundary-pages.tsx": boundaryPages(),
    "server/product/fragments.tsx": fragmentsFile(),

    "src/entry.client.tsx": entryClient(),
    "src/hydrate.client.tsx": hydrateClient(),
    "src/islands/counter.tsx": counterIsland(),
    "src/islands/account-panel.tsx": accountPanelIsland(),
    "src/islands/live-ticks.tsx": liveTicksIsland(),
    "src/features/home/home-page.tsx": homePage(),
    "src/features/showcase/showcase-page.tsx": showcasePage(),
    "src/features/showcase/server-time-fragment.tsx": serverTimeFragment(),
    "src/features/catalog/catalog-page.tsx": catalogPage(),
    "src/features/items/item-detail-page.tsx": itemDetailPage(),
    "src/features/live/live-page.tsx": livePage(),
    "src/components/layout/root-layout.tsx": rootLayout(title),
    "src/components/ui/responsive-image.tsx": responsiveImageComponent(),
    "src/lib/shell-data.ts": libShellData(),
    "src/lib/cache-keys.ts": cacheKeys(),
    "src/lib/pagination.ts": paginationLib(),
    "src/lib/metadata/site-defaults.ts": siteDefaults(title),
    "src/routing/rules.ts": routingRules(),
    "src/styles/globals.css": globalsCss(standalone),
    "src/global.d.ts": globalDts(),

    "tests/home.test.ts": homeTest(),

    // Claude Code integration — an always-loaded project guide, a pre-approved
    // permission allowlist, and the skill set. Identical in both modes; the
    // generated app source they describe is too.
    "CLAUDE.md": asset("generated-claude.md"),
    ".claude/settings.json": claudeSettings(),
    ...renderSkills("react"),
  };
}

/**
 * The vanilla file map. Same platform contract, different renderer: routes and
 * pages return HTML nodes, islands are plain modules, and no React package is
 * installed at all.
 *
 * @param {{ name: string; title: string; port: number; metricsPort: number;
 *           standalone: boolean; version: string }} vars
 */
function vanillaTemplates({
  name,
  title,
  port,
  metricsPort,
  vitePort,
  standalone,
  version,
  registry,
  withOps,
}) {
  return {
    ...(registry ? { ".npmrc": npmrc(registry) } : {}),
    "package.json": packageJson(name, { standalone, version, renderer: "vanilla", withOps }),
    "tsconfig.json": tsconfig(standalone, "vanilla"),
    "eslint.config.js": eslintConfig(),
    ".prettierrc.json": asset("prettierrc.json"),
    ".prettierignore": prettierIgnore(),
    "vite.config.ts": vanilla.viteConfig(vitePort),
    "vite.server.config.ts": vanilla.viteServerConfig(),
    "vitest.config.ts": vitestConfig(name),
    ".env.development": envDevelopment(name, port, metricsPort, vitePort),
    ".env.production": envProduction(port, metricsPort),
    "README.md": vanilla.readme(name, title, port, vitePort, standalone),
    Dockerfile: dockerfile(name, port, standalone),
    ".dockerignore": asset("dockerignore"),
    ".gitignore": asset("gitignore"),
    ".nvmrc": asset("nvmrc"),
    ".editorconfig": asset("editorconfig"),
    ".github/workflows/ci.yml": githubWorkflow(name),
    // Opt-in deployment assets: compose, k8s manifests, a load generator.
    ...(withOps ? renderOpsTemplates({ name, port, metricsPort }) : {}),

    "server/index.ts": serverIndex("/src/entry.client.ts"),
    "server/api/index.ts": vanilla.apiIndex(),
    "server/seo.ts": seoRoutes(),
    "server/metrics/catalog.ts": productMetrics(),
    "server/product/config.ts": productConfigFile(),
    "server/product/analytics.ts": productAnalytics(),
    "server/api/items.ts": publicItemsApi(),
    "server/api/session.ts": sessionApi(),
    "server/media.config.json": mediaConfig(),
    "src/assets/images/og-cover.svg": ogCoverSvg(title),
    "src/assets/images/hero.svg": heroSvg(title),
    "src/assets/images/brand-mark.svg": brandMarkSvg(),
    "server/routes/index.ts": vanilla.routesIndex(),
    "server/routes/home.ts": vanilla.homeRoute(title),
    "server/routes/catalog.ts": vanilla.catalogRoute(),
    "server/routes/item-detail.ts": vanilla.itemDetailRoute(),
    "server/services/shell-data.ts": vanilla.serverShellData(),
    "server/services/items.ts": itemsService(),
    "server/services/profile.ts": profileService(),
    "server/services/gateway-contracts.ts": gatewayContracts(),
    "mock-gateway/server.mjs": mockGateway(),
    "server/product/runtime.ts": vanilla.productRuntime(),
    "server/product/document-shell.ts": productDocumentShell(title),
    "server/product/renderer.ts": vanilla.productRenderer(),
    "server/product/boundary-pages.ts": vanilla.boundaryPages(),

    "src/entry.client.ts": vanilla.entryClient(),
    "src/hydrate.client.ts": vanilla.hydrateClient(),
    "src/islands/counter.ts": vanilla.counterIsland(),
    "src/pages/home.ts": vanilla.homePage(),
    "src/pages/catalog.ts": vanilla.catalogPage(),
    "src/pages/item-detail.ts": vanilla.itemDetailPage(),
    "src/components/layout.ts": vanilla.layoutComponent(title),
    "src/lib/shell-data.ts": vanilla.libShellData(),
    "src/lib/cache-keys.ts": vanilla.cacheKeys(),
    "src/lib/pagination.ts": paginationLib(),
    "src/lib/metadata/site-defaults.ts": siteDefaults(title),
    "src/routing/rules.ts": routingRules(),
    "src/styles/globals.css": vanilla.globalsCss(standalone),

    "tests/home.test.ts": homeTest(),

    "CLAUDE.md": asset("generated-claude-vanilla.md"),
    ".claude/settings.json": claudeSettings(),
    ...renderSkills("vanilla"),
  };
}

// Pre-approve the safe, everyday commands this app actually ships, so Claude Code
// runs them without a permission prompt. Deliberately conservative — no publish,
// no push, no wildcards.
const claudeSettings = () =>
  `${JSON.stringify(
    {
      permissions: {
        allow: [
          "Bash(pnpm install)",
          "Bash(pnpm dev)",
          "Bash(pnpm build)",
          "Bash(pnpm typecheck)",
          "Bash(pnpm check:cycles)",
          "Bash(pnpm lint)",
          "Bash(pnpm lint:fix)",
          "Bash(pnpm format)",
          "Bash(pnpm format:check)",
          "Bash(pnpm test)",
          "Bash(pnpm test:*)",
          "Bash(pnpm smoke)",
          "Bash(git status)",
          "Bash(git diff:*)",
          "Bash(git log:*)",
        ],
      },
    },
    null,
    2,
  )}\n`;

/** @param {{ standalone: boolean; version: string; renderer?: "react" | "vanilla" }} opts */
const packageJson = (name, { standalone, version, renderer = "react", withOps = false }) => {
  // workspace apps link the packages by workspace:*; standalone apps pin the
  // published version range passed via --version.
  const originloom = standalone ? version : "workspace:*";
  // In a workspace, native build scripts are approved once at the repo root
  // (pnpm-workspace.yaml). A standalone repo is its own root, so it must approve
  // the ones its dependency tree pulls in — otherwise pnpm install prints an
  // "Ignored build scripts" warning. Mirrors the platform's trusted set.
  const pnpm = standalone
    ? { onlyBuiltDependencies: ["@tailwindcss/oxide", "esbuild", "protobufjs", "sharp"] }
    : undefined;
  return `${JSON.stringify(
    {
      name,
      private: true,
      type: "module",
      engines: { node: ">=22.12.0" },
      scripts: {
        dev: "origin-dev --gateway mock-gateway/server.mjs",
        "mock-gw": "origin-run-with-env development node mock-gateway/server.mjs",
        build: "origin-build",
        start: "origin-run-with-env production node --enable-source-maps dist/server/index.js",
        "start:dev": "origin-run-with-env development node --import tsx/esm server/index.ts",
        smoke: "origin-smoke --gateway mock-gateway/server.mjs",
        typecheck: "tsc --noEmit",
        "check:cycles": "origin-check-cycles",
        // Icon codegen emits React components, so it ships with that renderer only.
        ...(renderer === "vanilla" ? {} : { icons: "origin-generate-icons" }),
        media: "origin-build-media",
        lint: "eslint .",
        "lint:fix": "eslint . --fix",
        format: "prettier --write .",
        "format:check": "prettier --check .",
        test: "vitest run",
        // Deployment helpers, generated only with --with-ops.
        ...(withOps
          ? {
              "compose:up": "origin-compose-up",
              "compose:redis": "origin-compose-up --redis",
              "compose:clean": "origin-docker-clean",
              "dev:redis": "origin-dev-local",
              "start:local:redis": "origin-run-local production --redis",
              loadtest: "node load-test/run.mjs",
            }
          : {}),
        // What CI runs, in one command, so it can be run locally too.
        ci: "pnpm run typecheck && pnpm run check:cycles && pnpm run lint && pnpm run format:check && pnpm run test && pnpm run build && pnpm run smoke",
      },
      dependencies: {
        "@hono/node-server": "^1.13.7",
        "@originloom/core": originloom,
        "@originloom/shared": originloom,
        ...(renderer === "vanilla"
          ? { "@originloom/vanilla": originloom }
          : { "@originloom/react": originloom }),
        "@tailwindcss/vite": "^4.3.2",
        ...(renderer === "vanilla" ? {} : { clsx: "^2.1.1" }),
        hono: "^4.6.14",
        ...(renderer === "vanilla" ? {} : { react: "^19.0.0", "react-dom": "^19.0.0" }),
        tailwindcss: "^4.3.2",
        tsx: "^4.19.2",
      },
      devDependencies: {
        "@eslint/js": "^9.39.5",
        "@originloom/tooling": originloom,
        "@types/node": "^22.10.2",
        ...(renderer === "vanilla"
          ? {}
          : {
              "@types/react": "^19.0.2",
              "@types/react-dom": "^19.0.2",
              "@vitejs/plugin-react": "^5.2.0",
            }),
        eslint: "^9.39.5",
        "eslint-config-prettier": "^10.1.8",
        "eslint-plugin-simple-import-sort": "^13.0.0",
        globals: "^17.7.0",
        prettier: "^3.9.5",
        typescript: "^5.7.2",
        "typescript-eslint": "^8.64.0",
        vite: "^8.1.5",
        vitest: "^4.1.10",
      },
      ...(pnpm ? { pnpm } : {}),
    },
    null,
    2,
  )}\n`;
};

// The compiler options the monorepo keeps in tsconfig.base.json. A standalone app
// has no parent to extend, so it carries them inline. Hand-formatted to match
// Prettier (short arrays inlined) so a fresh app passes its own format:check.
const BASE_COMPILER_OPTIONS = `    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
`;

const APP_COMPILER_OPTIONS = `    "types": ["node", "vite/client"],
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"],
      "@server/*": ["./server/*"]
    }`;

const tsconfig = (standalone, renderer = "react") => {
  const extendsLine = standalone ? "" : `  "extends": "../../tsconfig.base.json",\n`;
  // A vanilla app has no JSX, so a standalone one does not carry the setting.
  const base =
    renderer === "vanilla"
      ? BASE_COMPILER_OPTIONS.replace(`    "jsx": "react-jsx",\n`, "")
      : BASE_COMPILER_OPTIONS;
  const options = standalone ? base + APP_COMPILER_OPTIONS : APP_COMPILER_OPTIONS;
  return `{
${extendsLine}  "compilerOptions": {
${options}
  },
  "include": ["src", "server", "tests", "vite.config.ts", "vite.server.config.ts", "vitest.config.ts"]
}
`;
};

const eslintConfig = () => `import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Dev fixtures and scripts run in plain Node, not in the browser.
    files: ["mock-gateway/**/*.mjs", "scripts/**/*.mjs", "load-test/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Tool configs that have to stay CommonJS (SVGR reads .cjs with require).
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      // Ambient module augmentation (e.g. the ssr-fragment JSX typing) needs a namespace.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
`;

const prettierIgnore = () => `dist
coverage
pnpm-lock.yaml
`;

const viteConfig = (vitePort) => `import { resolve } from "node:path";

import { createClientViteConfig } from "@originloom/react/vite";
import { defineConfig } from "vite";

export default defineConfig(
  createClientViteConfig({
    entry: resolve(__dirname, "src/entry.client.tsx"),
    alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") },
    // Every app owns a port, so several can run side by side.
    devServer: { port: ${vitePort} },
    reload: {
      shouldReload: (file) =>
        file.includes("/server/") ||
        file.includes("/src/features/") ||
        file.includes("/src/components/"),
    },
  }),
);
`;

const viteServerConfig = () => `import { resolve } from "node:path";

import { createServerViteConfig } from "@originloom/react/vite";
import { defineConfig } from "vite";

export default defineConfig(
  createServerViteConfig({
    entry: resolve(__dirname, "server/index.ts"),
    alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") },
    // Self-contained server bundle: the production image ships dist/ only.
    noExternal: true,
  }),
);
`;

const vitestConfig = (name) => `import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
      "@server": resolve(__dirname, "server"),
    },
  },
  test: {
    name: "${name}",
    // Workspace packages ship source; inline them so vi.mock reaches their internals.
    server: { deps: { inline: [/@originloom\\//] } },
  },
});
`;

const envDevelopment = (name, port, metricsPort, vitePort) => `NODE_ENV=development
APP_ENV=development
PORT=${port}
METRICS_PORT=${metricsPort}
SITE_URL=http://127.0.0.1:${port}
VITE_DEV_SERVER_URL=http://127.0.0.1:${vitePort}

# L1-only cache; no Redis needed for local development.
CACHE_BACKEND=memory
CACHE_REQUIRED=false

# Upstream API. "pnpm dev" starts mock-gateway/server.mjs on this port.
GATEWAY_URL=http://127.0.0.1:4002
ALLOW_INSECURE_GATEWAY=true

# This app's own settings — see server/product/config.ts, validated at startup.
CATALOG_PAGE_SIZE=3
# SUPPORT_EMAIL is optional here and required in production.
# SUPPORT_EMAIL=destek@example.com

# Cache inspect/purge on the operations port. Without it those endpoints stay
# open in development and refuse to answer in production.
# CACHE_PURGE_SECRET=change-me

# ── Platform knobs ───────────────────────────────────────────────────────────
# All of these have working defaults in @originloom/core; the values shown are
# those defaults. They are listed commented out so you can see which dials
# exist — uncomment one only when you have a reason, and prefer changing it in
# production config rather than here.
#
# Upstream and render budgets. A request that outlives its budget is failed on
# purpose: a slow page that still answers is worse than a fast error, because it
# holds a connection the next visitor needs.
# GATEWAY_TIMEOUT_MS=5000
# SSR_REQUEST_TIMEOUT_MS=15000
# API_REQUEST_TIMEOUT_MS=12000
# CACHE_FILL_TIMEOUT_MS=12000
#
# Render admission. Past max concurrency requests queue, and past the queue they
# are shed with 503 — the app stays responsive instead of collapsing under load.
# SSR_MAX_CONCURRENCY=32
# SSR_MAX_QUEUE=64
# SSR_QUEUE_WAIT_MS=250
#
# In-process HTML cache size, in entries.
# CACHE_MAX_ENTRIES=2000
#
# CSP is report-only in development and enforced in production. Turn it on here
# to find violations before they reach production.
# CSP_ENFORCE=true
#
# Behind a load balancer, so client IPs come from X-Forwarded-For. Leave off
# unless a proxy really is in front: with it on, any caller can claim any IP.
# TRUST_PROXY=false
# TRUSTED_PROXY_HOPS=1
#
# Graceful shutdown budget for in-flight requests.
# SHUTDOWN_TIMEOUT_MS=10000
#
# The consent tool the analytics sequence starts with. In development the mock
# gateway plays that part so the chain really runs; point this at your vendor.
ANALYTICS_VENDOR_URL=http://127.0.0.1:4002/vendor/consent.js

# Serving images and assets from a CDN. With IMAGE_TRANSFORM_URL set,
# responsiveImage() rewrites its candidates through it and the pages do not
# change at all; the CSP img-src picks up these origins on its own.
# ASSET_CDN_URL=https://cdn.example.com
# IMAGE_CDN_URL=https://images.example.com
# IMAGE_TRANSFORM_URL=https://images.example.com/transform

# Tracing. server/index.ts already calls register() and shuts the SDK down on
# exit; it stays a no-op until an endpoint is set, so nothing is exported until
# you point it somewhere. /metrics works either way.
# OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
# OTEL_SERVICE_NAME=\${name}
`;

const envProduction = (port, metricsPort) => `NODE_ENV=production
APP_ENV=production
PORT=${port}
METRICS_PORT=${metricsPort}

# Required in production — set these from your secret manager / deployment env:
#   SITE_URL, GATEWAY_URL, RELEASE_ID, AUTH_REFRESH_COORDINATION_SECRET
# RELEASE_ID also namespaces the shared Redis cache, so give each app its own.

# This app's own required setting, checked by validateProductConfig() at startup:
# with it missing the server refuses to boot rather than serving pages that
# cannot show a support address. Replace it; deployments should override it.
SUPPORT_EMAIL=destek@example.com

# Single-pod L1 cache. For a shared L2 cache across pods switch to redis and set
# REDIS_URL; CACHE_REQUIRED=true makes readiness fail when Redis is unreachable.
CACHE_BACKEND=memory
CACHE_REQUIRED=false
# CACHE_BACKEND=redis
# REDIS_URL=rediss://cache.internal:6379
`;

/** @param {string} clientEntry Dev-server path of this app's client entry module. */
const serverIndex = (clientEntry) => `import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { mountCachePurgeApi } from "@originloom/core/api/cache-purge";
import { createApp } from "@originloom/core/app";
import { readAssets } from "@originloom/core/assets";
import { cacheTopology, closeCache, initCache } from "@originloom/core/cache";
import { config, validateConfig } from "@originloom/core/config";
import { drainRevalidations } from "@originloom/core/handler";
import { register, shutdownInstrumentation } from "@originloom/core/instrumentation";
import { logError, logger } from "@originloom/core/logger";
import { createMetricsApp } from "@originloom/core/metrics-server";
import { configureRouting } from "@originloom/shared/routing";
import { validateRoutingRules } from "@originloom/shared/routing/validate";

import { createRewrites, redirects, rewrites } from "~/routing/rules";

import { mountApi } from "./api";
import { analyticsCsp } from "./product/analytics";
import { validateProductConfig } from "./product/config";
import { installProductRuntime } from "./product/runtime";
import { routes } from "./routes";
import { mountSeo } from "./seo";

let shuttingDown = false;
let httpServer: ServerType | null = null;
let metricsServer: ServerType | null = null;

async function main() {
  // The platform never imports product code; everything it needs is installed here.
  installProductRuntime();
  configureRouting({ redirects, rewrites, createRewrites });
  // Tracing has to start before anything it should trace. It stays off until
  // OTEL_EXPORTER_OTLP_ENDPOINT is set, so this line costs nothing locally.
  const tracingEnabled = register();
  validateConfig([validateProductConfig]);
  validateRoutingRules({ redirects, rewrites: createRewrites(config.gatewayUrl) });
  await initCache();

  // The entry path is the app's, not the platform's — in dev it is fetched from
  // the Vite server, so it has to match the file this app actually ships.
  const assets = readAssets({ clientEntry: "${clientEntry}", eagerIslands: [] });
  const app = createApp({
    assets,
    routes,
    mounts: { api: mountApi, seo: mountSeo },
    // /api/ticks streams until the client leaves, so it manages its own
    // lifetime — arming a request deadline on it would cut a healthy stream.
    longLivedRoutes: ["/api/ticks"],
    // Origins the document reaches that are not this app's own.
    csp: analyticsCsp,
    isShuttingDown: () => shuttingDown,
  });

  httpServer = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("server started", {
      port: info.port,
      cacheTopology: cacheTopology(),
      tracingEnabled,
      metricsPort: config.metricsPort,
    });
  });
  // The operations listener is never exposed publicly, so cache inspection and
  // purge live here rather than on the site itself. CACHE_PURGE_SECRET gates them.
  const metricsApp = createMetricsApp({ mounts: (app) => mountCachePurgeApi(app) });
  metricsServer = serve({ fetch: metricsApp.fetch, port: config.metricsPort });

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown signal received", { signal });

    const forceExit = setTimeout(() => {
      logger.error("shutdown timeout — forcing exit");
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExit.unref();

    void (async () => {
      try {
        await Promise.all([
          closeServer(httpServer),
          closeServer(metricsServer),
          drainRevalidations(config.revalidationDrainTimeoutMs),
        ]);
        await closeCache();
        // Last, so spans emitted while draining still get exported.
        await shutdownInstrumentation();
        logger.info("shutdown complete");
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        logError(err, { msg: "shutdown failed" });
        process.exit(1);
      }
    })();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function closeServer(server: ServerType | null): Promise<void> {
  return new Promise((resolvePromise) => {
    if (!server) return resolvePromise();
    server.close(() => resolvePromise());
  });
}

main().catch(async (err) => {
  logError(err, { msg: "failed to start server" });
  await shutdownInstrumentation().catch((shutdownError) => {
    logError(shutdownError, { msg: "instrumentation shutdown failed after startup error" });
  });
  process.exit(1);
});
`;

const mediaPage =
  () => `import type { ResponsiveImageData, UnoptimizedImageData } from "@originloom/shared/lib/media";

import { ResponsiveImage, UnoptimizedImage } from "~/components/ui/responsive-image";

export const MEDIA_DEMO_SIZES = "(min-width: 1024px) 50vw, 100vw";

export type MediaPageData = {
  responsive: ResponsiveImageData;
  unoptimized: UnoptimizedImageData;
  imageCdnEnabled: boolean;
  transformEnabled: boolean;
};

/**
 * The same source image delivered two ways, side by side, so the difference is
 * visible in the network panel rather than only in documentation.
 */
export function MediaPage({ data }: { data: MediaPageData }) {
  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Görsel pipeline</h1>
        <p className="text-slate-600">
          \`pnpm media\` tek bir kaynaktan avif/webp/jpeg adayları üretir. Aşağıdaki iki kart aynı
          görseli farklı sözleşmelerle sunuyor; tarayıcının hangisini indirdiğini Network
          panelinde görebilirsiniz.
        </p>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <Status enabled={data.imageCdnEnabled} label="IMAGE_CDN_URL" />
          <Status enabled={data.transformEnabled} label="IMAGE_TRANSFORM_URL" />
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="overflow-hidden rounded-lg border border-slate-200">
          <ResponsiveImage
            image={data.responsive}
            sizes={MEDIA_DEMO_SIZES}
            priority
            alt=""
            className="aspect-video w-full bg-slate-900 object-cover"
          />
          <div className="space-y-3 p-4">
            <h2 className="font-semibold text-slate-900">Responsive teslim</h2>
            <p className="text-sm leading-6 text-slate-600">
              Tarayıcı, gerçek slot genişliği ve cihaz piksel oranına göre adaylardan birini seçer.
              Bu sayfada 1280 px genişlikte 960 px'lik avif iner — 1440'lık değil.
            </p>
            <Contract
              values={[
                "srcset + sizes + <picture>",
                "Zorunlu intrinsic width / height",
                "LCP preload + fetchPriority=high",
                data.transformEnabled ? "CDN transformer aktif" : "Build-time Sharp varyantları",
              ]}
            />
            <code className="block overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-200">
              {data.responsive.srcSet}
            </code>
          </div>
        </article>

        <article className="overflow-hidden rounded-lg border border-slate-200">
          <UnoptimizedImage
            image={data.unoptimized}
            alt=""
            className="aspect-video w-full bg-slate-900 object-cover"
          />
          <div className="space-y-3 p-4">
            <h2 className="font-semibold text-slate-900">Dönüşümsüz teslim</h2>
            <p className="text-sm leading-6 text-slate-600">
              Dosya yeniden encode edilmez, srcset üretilmez, runtime proxy'ye girmez. CDN prefix'i
              varsa kaynağın önüne eklenir. Logo gibi zaten optimize edilmiş varlıklar için.
            </p>
            <Contract
              values={[
                "Tek src, dönüşüm ve srcset yok",
                "width / height yine zorunlu",
                data.imageCdnEnabled ? "IMAGE_CDN_URL prefix aktif" : "Origin path kullanılıyor",
                "Varsayılan native lazy loading",
              ]}
            />
            <code className="block overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-200">
              {data.unoptimized.src}
            </code>
          </div>
        </article>
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900">Font'lar</h2>
        <p className="text-sm leading-6 text-slate-600">
          Aynı pipeline self-host font da üretir: \`server/media.config.json\` içindeki \`fonts\`
          dizisine bir kaynak eklediğinizde WOFF2 subset'i hash'lenir, \`@font-face\` kuralı
          dokümana yazılır ve preload edilir. Bu uygulama şu an sistem fontlarıyla geliyor, o
          yüzden dizi boş.
        </p>
      </section>
    </div>
  );
}

function Status({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={
        enabled
          ? "rounded-full bg-emerald-100 px-3 py-1 text-emerald-800"
          : "rounded-full bg-slate-200 px-3 py-1 text-slate-600"
      }
    >
      {label}: {enabled ? "aktif" : "kapalı"}
    </span>
  );
}

function Contract({ values }: { values: string[] }) {
  return (
    <ul className="grid gap-2 text-sm text-slate-600">
      {values.map((value) => (
        <li key={value} className="flex gap-2">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400" />
          {value}
        </li>
      ))}
    </ul>
  );
}
`;

const mediaRoute = () => `import { config } from "@originloom/core/config";
import { responsiveImage, unoptimizedImage } from "@originloom/core/media";
import { defineRoute } from "@originloom/react/lib/types";
import { imagePreload } from "@originloom/shared/lib/media";

import { MEDIA_DEMO_SIZES, MediaPage, type MediaPageData } from "~/features/media/media-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<MediaPageData>({
  path: "/media",
  cache: (ctx) => pageCachePolicy(PageCacheId.media, ctx),
  loader: async () => ({
    data: {
      // Both come from the same manifest entry: one gets format and width
      // candidates, the other the original file.
      responsive: responsiveImage("hero"),
      unoptimized: unoptimizedImage("hero"),
      imageCdnEnabled: Boolean(config.imageCdnUrl),
      transformEnabled: Boolean(config.imageTransformUrl),
    },
  }),
  generateMetadata: () => ({
    title: "Görsel pipeline",
    // A technical demo has no business in search results.
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "media"),
  preloadImages: (data) => [imagePreload(data.responsive, MEDIA_DEMO_SIZES)],
  Component: MediaPage,
});
`;

const routesIndex = () => `import type { Route } from "@originloom/react/lib/types";

import account from "./account";
import catalog from "./catalog";
import home from "./home";
import itemDetail from "./item-detail";
import live from "./live";
import media from "./media";
import showcase from "./showcase";

/** The route table. Order matters: the first match wins. */
export const routes: Route[] = [home, catalog, itemDetail, account, live, media, showcase];
`;

const homeRoute = (title) => `import { responsiveImage } from "@originloom/core/media";
import { defineRoute } from "@originloom/react/lib/types";
import type { ResponsiveImageData } from "@originloom/shared/lib/media";
import { imagePreload } from "@originloom/shared/lib/media";

import { HERO_SIZES, HomePage } from "~/features/home/home-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { greeting: string; hero: ResponsiveImageData };

export default defineRoute<Data>({
  path: "/",
  cache: (ctx) => pageCachePolicy(PageCacheId.home, ctx),
  // Built from the media manifest, so the same call yields local files or CDN
  // URLs depending on IMAGE_TRANSFORM_URL — the page never knows which.
  loader: async () => ({ data: { greeting: "${title}", hero: responsiveImage("hero") } }),
  // The hero is the LCP element: preloading it in the head starts the download
  // before the browser has parsed the body it lives in.
  preloadImages: (data) => [imagePreload(data.hero, HERO_SIZES)],
  title: () => "${title}",
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "home"),
  Component: HomePage,
});
`;

const showcaseRoute = () => `import { defineRoute } from "@originloom/react/lib/types";

import { ShowcasePage } from "~/features/showcase/showcase-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { renderedAt: string };

export default defineRoute<Data>({
  path: "/showcase",
  cache: (ctx) => pageCachePolicy(PageCacheId.showcase, ctx),
  loader: async () => ({ data: { renderedAt: new Date().toISOString() } }),
  title: () => "Fragment örneği",
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "showcase"),
  Component: ShowcasePage,
});
`;

const fragmentsFile = () => `import type { FragmentDefinition } from "@originloom/core/runtime";

import { ServerTimeFragment } from "~/features/showcase/server-time-fragment";
import type { ShellData } from "~/lib/shell-data";

/**
 * Fragments are cached HTML blocks resolved independently of the page — each with
 * its own cache key and TTL. At serve time the platform stitches the resolved HTML
 * into the matching <ssr-fragment> placeholder, so a page cached for an hour can
 * carry a block refreshed every few seconds. Header/footer with their own cache
 * lifetime are the classic use; this one just stamps the server time so the
 * independent TTL is visible.
 */
export const productFragments: Record<string, FragmentDefinition<ShellData>> = {
  "server-time": {
    // Doesn't depend on the layout shell (menu/device), so it resolves even when
    // the shell is unavailable.
    requiresShell: false,
    // Resolve on a fresh render too, not only on cached-document hits.
    resolveOnFreshDocument: true,
    ttl: 15,
    key: () => "fragment:server-time:v1",
    resolve: () => <ServerTimeFragment renderedAt={new Date().toISOString()} />,
  },
};
`;

const showcasePage = () => `import { ServerTimeFragment } from "./server-time-fragment";

export function ShowcasePage({ data }: { data: { renderedAt: string } }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Fragment örneği</h1>
      <p className="max-w-2xl text-slate-600">
        Bu sayfanın HTML'i 1 saat cache'lenir. İçindeki blok ise bağımsız bir fragment: platform onu
        sayfadan ayrı, kendi TTL'i ile cache'ler ve her istekte aşağıdaki{" "}
        <code>&lt;ssr-fragment&gt;</code> yer tutucusuna yerleştirir.
      </p>
      <ssr-fragment name="server-time" style={{ display: "contents" }}>
        <ServerTimeFragment renderedAt={data.renderedAt} />
      </ssr-fragment>
      <p className="text-sm text-slate-500">
        Sayfayı birkaç saniye arayla yenileyin: sayfa gövdesi aynı kalırken fragment içindeki zaman,
        kendi TTL'i dolunca değişir.
      </p>
    </div>
  );
}
`;

const serverTimeFragment =
  () => `export function ServerTimeFragment({ renderedAt }: { renderedAt: string }) {
  return (
    <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
      Bağımsız fragment — sunucu zamanı: <code>{renderedAt}</code>
    </p>
  );
}
`;

const globalDts = () => `import type React from "react";

// Lets JSX accept the platform's <ssr-fragment> placeholder element.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ssr-fragment": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { name: string },
        HTMLElement
      >;
    }
  }
}
`;

const homeTest = () => `import { routes } from "@server/routes";
import { describe, expect, it } from "vitest";

import { isKnownPageCachePrefix, PageCacheId, pageCacheRegistry } from "~/lib/cache-keys";

describe("route table", () => {
  it("registers the home route at /", () => {
    expect(routes.some((route) => route.path === "/")).toBe(true);
  });
});

describe("page cache registry", () => {
  it("recognises its own page ids and rejects unknown prefixes", () => {
    expect(isKnownPageCachePrefix(PageCacheId.home)).toBe(true);
    expect(isKnownPageCachePrefix("definitely-not-a-page")).toBe(false);
  });

  it("keeps every entry's id in sync with its registry key", () => {
    for (const [key, definition] of Object.entries(pageCacheRegistry)) {
      expect(definition.id).toBe(key);
    }
  });
});
`;

const itemsService = () => `import { gatewayFetch } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedArray, isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

export type Item = { slug: string; name: string; blurb: string };
export type ItemPage = { items: Item[]; total: number };

const INVALID = "Items gateway returned an invalid payload";

/**
 * Server-only data orchestration. Loaders call these; nothing here runs in the
 * browser, so this is where upstream calls, validation and error mapping live.
 */
export async function listItems(
  page: number,
  perPage: number,
  signal: AbortSignal,
): Promise<ItemPage> {
  const response = await gatewayFetch(\`/items?page=\${page}&perPage=\${perPage}\`, { signal });
  if (!response.ok) throw new Error(\`Items gateway returned \${response.status}\`);

  // Bounded read against this endpoint's contract, then a runtime guard: gateway
  // JSON is untrusted input, and a TypeScript type is not a check.
  const payload = await readGatewayJson(response, GatewayContracts.items, INVALID);
  return requireGatewayPayload(GatewayContracts.items, payload, isItemPage, INVALID);
}

export async function getItem(slug: string, signal: AbortSignal): Promise<Item | null> {
  const response = await gatewayFetch(\`/items/\${encodeURIComponent(slug)}\`, { signal });
  // A missing item is data, not a failure — the route turns it into notFound().
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(\`Items gateway returned \${response.status}\`);

  const payload = await readGatewayJson(response, GatewayContracts.items, INVALID);
  return requireGatewayPayload(GatewayContracts.items, payload, isItem, INVALID);
}

function isItem(value: unknown): value is Item {
  return (
    isRecord(value) &&
    isBoundedString(value.slug, 100) &&
    isBoundedString(value.name, 200) &&
    isBoundedString(value.blurb, 1_000)
  );
}

function isItemPage(value: unknown): value is ItemPage {
  return (
    isRecord(value) &&
    isBoundedArray(value.items, 100, isItem) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total)
  );
}
`;

const apiIndex = () => `import { mountClientErrorApi } from "@originloom/core/api/client-errors";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountPublicItemsApi } from "@server/api/items";
import { mountSessionApi } from "@server/api/session";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

/**
 * Product BFF / API routes. Mounted before SSR dispatch, so anything under /api/*
 * is handled here and never reaches a page route.
 */
export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  // The island runtime reports client-side failures here. Without it every
  // browser error turns into a 404 in the console instead of a server log.
  mountClientErrorApi(app);

  mountPublicItemsApi(app);

  // "Who am I", answered from HttpOnly cookies. The account island calls it.
  mountSessionApi(app);

  // Demo Server-Sent Events stream: emits the server time once a second until the
  // client disconnects. The /live island consumes it with EventSource.
  app.get("/api/ticks", (c) =>
    streamSSE(c, async (stream) => {
      while (!c.req.raw.signal.aborted) {
        await stream.writeSSE({ event: "tick", data: new Date().toISOString() });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }),
  );
}
`;

const itemDetailRoute = () => `import { defineRoute, notFound } from "@originloom/react/lib/types";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { getItem, type Item } from "@server/services/items";

import { ItemDetailPage } from "~/features/items/item-detail-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { item: Item };

export default defineRoute<Data>({
  path: "/items/:slug",
  // Reject unbounded / garbage slugs before any cache lookup or render.
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  // The slug is part of the cache key (see cache-keys.ts), so each item caches on its own.
  cache: (ctx) => pageCachePolicy(PageCacheId.itemDetail, ctx),
  loader: async (ctx) => {
    const item = await getItem(ctx.params.slug ?? "", ctx.request.signal);
    // Terminal result, not a thrown error — an unknown slug is a 404, never cached.
    return item ? { data: { item } } : notFound();
  },
  generateMetadata: (data, ctx) => ({
    title: data.item.name,
    description: data.item.blurb,
    canonical: (ctx.siteUrl ?? ctx.url.origin) + "/items/" + data.item.slug,
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "item-detail"),
  Component: ItemDetailPage,
});
`;

const itemDetailPage = () => `import type { Item } from "@server/services/items";

export function ItemDetailPage({ data }: { data: { item: Item } }) {
  return (
    <div className="space-y-4">
      <a className="text-sm text-slate-500 hover:underline" href="/catalog">
        ← Kataloğa dön
      </a>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{data.item.name}</h1>
      <p className="max-w-2xl text-slate-600">{data.item.blurb}</p>
      <p className="text-sm text-slate-500">
        Bu sayfa dinamik bir route (<code>/items/:slug</code>). Slug cache key'e girer, bilinmeyen
        slug <code>validateParams</code> + <code>notFound()</code> ile 404 olur.
      </p>
    </div>
  );
}
`;

const accountRoute = () => `import { Island } from "@originloom/react/lib/island";
import { defineRoute } from "@originloom/react/lib/types";

import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

/**
 * Personal page: the document is never cached (registry strategy "never"), and the
 * per-user content comes from a defer island that fetches client-side. This is the
 * cache-safe personalization pattern — see the caching and islands skills.
 */
export default defineRoute({
  path: "/account",
  cache: (ctx) => pageCachePolicy(PageCacheId.account, ctx),
  loader: async () => ({ data: {} }),
  generateMetadata: () => ({
    title: "Hesabım",
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "account"),
  Component: () => (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Hesabım</h1>
      <Island name="account-panel" mode="defer">
        <p className="text-slate-400">Kişisel bilgiler yükleniyor…</p>
      </Island>
    </div>
  ),
});
`;

const accountPanelIsland = () => `import { useEffect, useState } from "react";

type Session =
  | { state: "loading" }
  | { state: "signed-in"; displayName: string; initials: string }
  | { state: "signed-out" }
  | { state: "unavailable" };

/**
 * Defer island: the server renders only the fallback, and this mounts in the
 * browser and asks /api/session who the user is. That is the cache-safe
 * personalization pattern — the document stays shared and cacheable while the
 * per-user part is fetched, so no one is ever served someone else's name.
 */
export default function AccountPanel() {
  const [session, setSession] = useState<Session>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // Cookies are HttpOnly, so the browser attaches them and no script reads them.
    fetch("/api/session", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return setSession({ state: "signed-out" });
        if (!response.ok) return setSession({ state: "unavailable" });
        const body = (await response.json()) as { profile: { displayName: string; initials: string } };
        setSession({ state: "signed-in", ...body.profile });
      })
      // An aborted fetch is a cancelled render, not a failure.
      .catch(() => {
        if (!controller.signal.aborted) setSession({ state: "unavailable" });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="rounded-md border border-slate-200 p-4">
      {session.state === "loading" ? <p className="text-slate-400">Oturum kontrol ediliyor…</p> : null}
      {session.state === "signed-in" ? (
        <>
          <p className="font-medium text-slate-900">
            <span className="mr-2 inline-block rounded-full bg-slate-900 px-2 py-1 text-xs text-white">
              {session.initials}
            </span>
            Merhaba {session.displayName}
          </p>
          <p className="text-sm text-slate-600">
            Bu blok yalnızca tarayıcıda render edildi ve hiçbir zaman paylaşılan cache'e girmez.
          </p>
        </>
      ) : null}
      {session.state === "signed-out" ? (
        <p className="text-sm text-slate-600">Giriş yapılmamış.</p>
      ) : null}
      {/* "Bilinmiyor" is not "çıkış yapıldı": an upstream hiccup must not sign anyone out. */}
      {session.state === "unavailable" ? (
        <p className="text-sm text-slate-600">Oturum bilgisi şu an alınamıyor.</p>
      ) : null}
    </div>
  );
}
`;

const catalogRoute = () => `import { defineRoute } from "@originloom/react/lib/types";
import { observeCatalogView } from "@server/metrics/catalog";
import { productConfig } from "@server/product/config";
import { type Item, listItems } from "@server/services/items";

import { CatalogPage } from "~/features/catalog/catalog-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { pageParam } from "~/lib/pagination";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { items: Item[]; page: number; totalPages: number };

export default defineRoute<Data>({
  path: "/catalog",
  // Only the normalized ?page value changes the HTML, so only it enters the key.
  cache: (ctx) => pageCachePolicy(PageCacheId.catalog, ctx),
  loader: async (ctx) => {
    const page = pageParam(ctx.url);
    const perPage = productConfig.catalogPageSize;
    const { items, total } = await listItems(page, perPage, ctx.request.signal);
    observeCatalogView(page);
    return { data: { items, page, totalPages: Math.max(1, Math.ceil(total / perPage)) } };
  },
  title: () => "Katalog",
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "catalog"),
  Component: CatalogPage,
});
`;

const catalogPage = () => `import type { Item } from "@server/services/items";

type Props = { data: { items: Item[]; page: number; totalPages: number } };

export function CatalogPage({ data }: Props) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Katalog</h1>
      <ul className="divide-y divide-slate-100">
        {data.items.map((item) => (
          <li key={item.slug} className="py-3">
            <a className="font-medium text-slate-800 hover:underline" href={"/items/" + item.slug}>
              {item.name}
            </a>
            <p className="text-sm text-slate-500">{item.blurb}</p>
          </li>
        ))}
      </ul>
      <nav className="flex items-center gap-4 text-sm">
        {data.page > 1 ? (
          <a className="text-slate-700 hover:underline" href={"?page=" + (data.page - 1)}>
            ← Önceki
          </a>
        ) : (
          <span className="text-slate-300">← Önceki</span>
        )}
        <span aria-current="page" className="text-slate-500">
          Sayfa {data.page} / {data.totalPages}
        </span>
        {data.page < data.totalPages ? (
          <a className="text-slate-700 hover:underline" href={"?page=" + (data.page + 1)}>
            Sonraki →
          </a>
        ) : (
          <span className="text-slate-300">Sonraki →</span>
        )}
      </nav>
      <p className="text-sm text-slate-500">
        Query param (<code>?page</code>) allowlist ile cache key'e girer; tracking param'ları
        girmez.
      </p>
    </div>
  );
}
`;

const liveRoute = () => `import { defineRoute } from "@originloom/react/lib/types";
import { neverCache } from "@originloom/shared/lib/cache-policy";

import { LivePage } from "~/features/live/live-page";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { slowMessage: Promise<string> };

export default defineRoute<Data>({
  path: "/live",
  // Progressive HTML: the shell streams first, Suspense boundaries fill in later.
  streaming: true,
  cache: () => neverCache(),
  loader: async () => ({
    data: {
      // Resolves after the shell has already streamed — Suspense fills it in.
      slowMessage: new Promise<string>((resolve) => {
        setTimeout(() => resolve(new Date().toISOString()), 600);
      }),
    },
  }),
  title: () => "Canlı veri",
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "live"),
  Component: LivePage,
});
`;

const livePage = () => `import { Island } from "@originloom/react/lib/island";
import { Suspense, use } from "react";

export function LivePage({ data }: { data: { slowMessage: Promise<string> } }) {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Canlı veri</h1>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-800">1) Sunucu streaming (Suspense)</h2>
        <p className="text-sm text-slate-500">
          Sayfa hemen döner; aşağıdaki değer sunucuda geç hazır olunca stream edilir.
        </p>
        <Suspense fallback={<p className="text-slate-400">Yükleniyor…</p>}>
          <SlowMessage promise={data.slowMessage} />
        </Suspense>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-800">2) SSE (client island)</h2>
        <p className="text-sm text-slate-500">
          Defer island tarayıcıda <code>/api/ticks</code> SSE akışına bağlanır.
        </p>
        <Island name="live-ticks" mode="defer">
          <p className="text-slate-400">Bağlanıyor…</p>
        </Island>
      </section>
    </div>
  );
}

function SlowMessage({ promise }: { promise: Promise<string> }) {
  const message = use(promise);
  return (
    <p className="text-slate-700">
      Sunucudan geç gelen değer: <code>{message}</code>
    </p>
  );
}
`;

const liveTicksIsland = () => `import { useEffect, useState } from "react";

/** Defer island: subscribes to the /api/ticks SSE stream in the browser. */
export default function LiveTicks() {
  const [tick, setTick] = useState("bağlanıyor…");
  useEffect(() => {
    const source = new EventSource("/api/ticks");
    source.addEventListener("tick", (event: MessageEvent<string>) => setTick(event.data));
    source.onerror = () => source.close();
    return () => source.close();
  }, []);
  return (
    <p className="text-slate-700">
      Son tick: <code>{tick}</code>
    </p>
  );
}
`;

const paginationLib =
  () => `/** Reads a 1-based page number from ?page, clamped to a sane minimum. */
export function pageParam(url: URL): number {
  const raw = Number(url.searchParams.get("page"));
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}
`;

const serverShellData = () => `import type { Ctx } from "@originloom/react/lib/types";

import { buildLayoutClientProps, type ShellData } from "~/lib/shell-data";

/**
 * Per-request shell data: everything the layout needs that is not route data.
 * Fetch navigation, feature flags or branding here — keep it cache-safe
 * (no auth tokens, no user-specific values).
 */
export async function buildShellData(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean | undefined },
): Promise<ShellData> {
  return buildLayoutClientProps(ctx, opts);
}
`;

const productRuntime =
  () => `import { installRuntime, type OriginRuntime } from "@originloom/core/runtime";
import { configureSiteMetadata } from "@originloom/shared/lib/metadata/site-config";
import { catalogMetricLines } from "@server/metrics/catalog";
import { buildShellData } from "@server/services/shell-data";

import { isKnownPageCachePrefix } from "~/lib/cache-keys";
import { siteMetadata } from "~/lib/metadata/site-defaults";
import type { ShellData } from "~/lib/shell-data";

import { productDocumentShell } from "./document-shell";
import { productFragments } from "./fragments";
import { productRenderer } from "./renderer";

/**
 * The product side of the platform contract. @originloom/core reads this instead
 * of importing anything from this app.
 */
export const productRuntime: OriginRuntime<ShellData> = {
  // Turns this app's React views into HTML. Swapping this swaps the UI framework.
  renderer: productRenderer,
  // Cached HTML fragments resolved independently of the page (header, footer, …).
  fragments: productFragments,
  buildShellData,
  isShellUsableForFragments: () => true,
  document: productDocumentShell,
  cacheKeys: { isKnownPageCachePrefix },
  // This app's own metrics, appended to the platform's /metrics output.
  metricSources: [catalogMetricLines],
};

export function installProductRuntime(): void {
  configureSiteMetadata({ site: siteMetadata });
  installRuntime(productRuntime);
}
`;

const productDocumentShell = (
  title,
) => `import type { DocumentShell } from "@originloom/core/runtime";
import { mergeMetadata } from "@originloom/shared/lib/metadata/merge";
import { resolveDocumentMetadata } from "@originloom/shared/lib/metadata/resolve";
import type { Ctx, Route } from "@originloom/shared/lib/types";

import { defaultPageMeta } from "~/lib/shell-data";

const BOT_UA = /bot|crawl|spider|slurp|bingpreview/i;

/** Document policy: language, bot detection, metadata. Views live in ./renderer. */
export const productDocumentShell: DocumentShell = {
  htmlLang: "tr",
  errorPageTitle: "Sayfa gösterilemiyor | ${title}",
  isBotRequest: (request) => BOT_UA.test(request.headers.get("user-agent") ?? ""),
  resolveMetadata: <T>(route: Route<T>, data: T, ctx: Ctx) =>
    resolveDocumentMetadata(route, data, ctx),
  boundaryMetadata: (kind, ctx) =>
    mergeMetadata(
      kind === "not-found"
        ? {
            title: "Sayfa bulunamadı",
            description: "Aradığınız sayfa bulunamadı.",
            robots: { index: false, follow: false },
          }
        : {
            title: "Sayfa gösterilemiyor",
            description: "Bu sayfa şu anda gösterilemiyor.",
            robots: { index: false, follow: false },
          },
      ctx,
    ),
  defaultPageMeta: (ctx, pageType) => defaultPageMeta(ctx, pageType),
};
`;

const productAnalytics = () => `import { config } from "@originloom/core/config";
import type { CspSources } from "@originloom/core/middleware/security";
import { sequencedScript } from "@originloom/shared/head-scripts";

/**
 * Third-party scripts that have to run in a fixed order.
 *
 * Plain scripts written in head order already run in that order — this exists
 * for the two cases where that is not enough: a step whose readiness comes
 * later than its execution (a consent tool fetching its own configuration),
 * and not wanting to block the parser on every vendor round trip.
 *
 * In development the vendor is the mock gateway, so the sequence really runs.
 * Point ANALYTICS_VENDOR_URL at the real one and the shape does not change.
 */
const vendorUrl =
  process.env.ANALYTICS_VENDOR_URL?.trim() || \`\${config.gatewayUrl}/vendor/consent.js\`;

export const analyticsSequence = sequencedScript(
  [
    // 1. The consent tool. It executes immediately and is only usable once it
    //    has decided, so the chain waits for the event rather than the load.
    { src: vendorUrl, awaitEvent: "consent:ready" },
    // 2. Now the decision exists, so the dataLayer can be built from it.
    {
      code: \`window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:"app.ready",consent:window.__consent===true});\`,
    },
    // 3. Your tag manager belongs here, after the dataLayer it will read.
    //    { src: "https://www.googletagmanager.com/gtm.js?id=GTM-XXXX" },
    // 4. Your own measurement, last, so it can report what the steps decided.
    { code: \`navigator.sendBeacon("/api/collect", JSON.stringify(window.dataLayer))\` },
  ],
  // A vendor that never answers must not strand the steps behind it.
  { timeoutMs: 4_000 },
);

/** The origins the sequence reaches. Without these the browser refuses to load them. */
export const analyticsCsp: CspSources = {
  scriptSrc: [new URL(vendorUrl).origin],
};
`;

const productRenderer =
  () => `import { MetadataHead } from "@originloom/react/lib/metadata/metadata-head";
import { createReactRenderer } from "@originloom/react/server";
import { analyticsSequence } from "@server/product/analytics";

import { RootLayout } from "~/components/layout/root-layout";
import type { ShellData } from "~/lib/shell-data";

import { NotFoundPage, RouteErrorPage } from "./boundary-pages";

/** The React half of the runtime contract: every view the document renders. */
export const productRenderer = createReactRenderer<ShellData>({
  NotFoundComponent: NotFoundPage,
  ErrorComponent: RouteErrorPage,
  renderHeadStart: ({ seo, cspNonce }) => <MetadataHead meta={seo} nonce={cspNonce} />,
  /**
   * The analytics chain. Two things make it work: the nonce on the inline
   * script, and the vendor's host in \`createApp({ csp })\` — the platform
   * blesses no vendor. Nothing user-specific may appear here, because this
   * markup enters the shared HTML cache. See .claude/skills/third-party-scripts.
   */
  renderHeadEnd: ({ cspNonce, isBot }) =>
    isBot ? null : (
      <script nonce={cspNonce} dangerouslySetInnerHTML={{ __html: analyticsSequence }} />
    ),
  renderLayout: ({ shell, pageMeta, children }) => (
    <RootLayout shell={shell} pageMeta={pageMeta}>
      {children}
    </RootLayout>
  ),
});
`;

const boundaryPages = () => `import type { RouteError } from "@originloom/react/lib/types";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 py-16 text-center">
      <p className="text-sm font-semibold text-slate-500">404</p>
      <h1 className="text-2xl font-bold text-slate-900">Aradığınız sayfa bulunamadı</h1>
      <a className="inline-block font-medium text-slate-700 hover:underline" href="/">
        Ana sayfaya dön
      </a>
    </div>
  );
}

export function RouteErrorPage({ error }: { error: RouteError | null; status: number }) {
  return (
    <div className="mx-auto max-w-2xl space-y-3 py-16 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Bu sayfa şu anda gösterilemiyor</h1>
      <p className="text-slate-600">{error?.message ?? "Lütfen daha sonra tekrar deneyin."}</p>
      <button
        type="button"
        data-reload-page
        className="cursor-pointer border-0 bg-transparent p-0 font-medium text-slate-700 hover:underline"
      >
        Tekrar dene
      </button>
    </div>
  );
}
`;

const entryClient = () => `import "./styles/globals.css";

import { reportClientError } from "@originloom/shared/lib/client/error-telemetry";
import { runIslandBootstrap } from "@originloom/shared/lib/client/island-runtime";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";

installReloadButtons();

runIslandBootstrap(
  (element) => {
    import("./hydrate.client")
      .then(({ mount }) => void mount(element))
      .catch((error) => reportClientError("island-bootstrap", error));
  },
  { onObserverError: (error) => reportClientError("island-bootstrap", error) },
);
`;

const hydrateClient =
  () => `import { createIslandMounter, type IslandModule } from "@originloom/react/lib/client/island-mount";

// import.meta.glob resolves relative to this file, so the island registry is
// app-owned by design. Every src/islands/*.tsx becomes an island named after it.
export const mount = createIslandMounter({
  modules: import.meta.glob<IslandModule>("./islands/*.tsx"),
});
`;

const counterIsland = () => `import { useState } from "react";

/** Example island — proves hydration works. Delete once you have real ones. */
export default function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start);
  return (
    <button
      type="button"
      onClick={() => setCount((value) => value + 1)}
      className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
    >
      Tıklandı: {count}
    </button>
  );
}
`;

const homePage = () => `import { Island } from "@originloom/react/lib/island";
import type { ResponsiveImageData } from "@originloom/shared/lib/media";

import { ResponsiveImage } from "~/components/ui/responsive-image";

/**
 * Declared next to the markup that decides it, and imported by the route so the
 * head preload asks for exactly the candidate the layout will use. Two copies
 * of this string is how a preload downloads a second, unused file.
 */
export const HERO_SIZES = "(min-width: 1024px) 960px, 100vw";

export function HomePage({ data }: { data: { greeting: string; hero: ResponsiveImageData } }) {
  return (
    <div className="space-y-6">
      <ResponsiveImage
        image={data.hero}
        sizes={HERO_SIZES}
        priority
        alt=""
        className="w-full rounded-lg"
      />
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{data.greeting}</h1>
      <p className="max-w-2xl text-slate-600">
        Bu sayfa sunucuda render edildi. Aşağıdaki buton bağımsız bir island olarak hydrate olur —
        sayfanın geri kalanı statik HTML kalır.
      </p>
      <Island name="counter" props={{ start: 0 }}>
        <button type="button" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white">
          Tıklandı: 0
        </button>
      </Island>

      <section className="space-y-2 border-t border-slate-100 pt-6">
        <h2 className="font-semibold text-slate-800">Örnek route'lar</h2>
        <p className="text-sm text-slate-500">Her biri farklı bir platform yeteneğini gösterir:</p>
        <ul className="space-y-1 text-slate-700">
          <li>
            <a className="hover:underline" href="/catalog">
              /catalog
            </a>{" "}
            — sayfalı liste (query param cache key'de)
          </li>
          <li>
            <a className="hover:underline" href="/items/alpha">
              /items/:slug
            </a>{" "}
            — dinamik route, <code>validateParams</code> + <code>notFound()</code> + SEO
          </li>
          <li>
            <a className="hover:underline" href="/account">
              /account
            </a>{" "}
            — kişisel sayfa: <code>neverCache</code> + defer island
          </li>
          <li>
            <a className="hover:underline" href="/live">
              /live
            </a>{" "}
            — sunucu streaming (Suspense) + SSE island
          </li>
          <li>
            <a className="hover:underline" href="/media">
              /media
            </a>{" "}
            — görsel pipeline: responsive vs dönüşümsüz teslim, CDN durumu
          </li>
          <li>
            <a className="hover:underline" href="/showcase">
              /showcase
            </a>{" "}
            — bağımsız cache'lenen fragment
          </li>
        </ul>
      </section>
    </div>
  );
}
`;

const rootLayout = (
  title,
) => `import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ReactNode } from "react";

import type { ShellData } from "~/lib/shell-data";

export type RootLayoutProps = {
  shell: ShellData;
  pageMeta: PageAnalyticsMeta;
  children: ReactNode;
};

// Kept out of the markup so the JSX layout does not depend on how long the name is.
const SITE_NAME = "${title}";

/** Application shell. Header/footer that need their own cache lifetime belong in fragments. */
export function RootLayout({ shell, children }: RootLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      {shell.minimalChrome ? null : (
        <header className="border-b border-slate-200">
          <div className="mx-auto flex max-w-5xl items-center px-4 py-4">
            <a href="/" className="text-lg font-semibold text-slate-900">
              {SITE_NAME}
            </a>
          </div>
        </header>
      )}

      <main id="page-main" className="flex-1 py-10">
        <div className="mx-auto max-w-5xl px-4">{children}</div>
      </main>

      {shell.minimalChrome ? null : (
        <footer className="border-t border-slate-200 py-6">
          <div className="mx-auto max-w-5xl px-4 text-sm text-slate-500">
            {SITE_NAME} — OriginLoom
          </div>
        </footer>
      )}
    </div>
  );
}
`;

const libShellData = () => `import type { Ctx } from "@originloom/react/lib/types";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import { Cookie } from "@originloom/shared/lib/cookies";
import type { DeviceType } from "@originloom/shared/lib/device";
import { deviceCacheFragment, getDeviceShell } from "@originloom/shared/lib/device";
import { cookie } from "@originloom/shared/lib/request";

/** Cache-safe props for the shell — no trackingId, no auth tokens. */
export type ShellData = {
  publicPath: string;
  pathname: string;
  theme?: string;
  minimalChrome?: boolean;
  deviceType: DeviceType;
  deviceShell: "desktop" | "mobile";
};

export function buildLayoutClientProps(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean | undefined },
): ShellData {
  const deviceType = deviceCacheFragment(ctx.request);
  const theme = cookie(ctx.request, Cookie.theme);
  return {
    publicPath: ctx.publicPath,
    pathname: ctx.url.pathname,
    ...(theme !== undefined ? { theme } : {}),
    ...(opts?.minimalChrome !== undefined ? { minimalChrome: opts.minimalChrome } : {}),
    deviceType,
    deviceShell: getDeviceShell(deviceType),
  };
}

/** Add to the HTML cache key — the shell varies per device. */
export function layoutCacheFragment(ctx: Ctx): string {
  return deviceCacheFragment(ctx.request);
}

export function defaultPageMeta(
  ctx: Ctx,
  pageType: string,
  extra?: Partial<PageAnalyticsMeta>,
): PageAnalyticsMeta {
  return { pageType, publicPath: ctx.publicPath, ...extra };
}
`;

const cacheKeys = () => `import type { CachePolicy, Ctx } from "@originloom/react/lib/types";
import { neverCache, sharedUnlessBypass } from "@originloom/shared/lib/cache-policy";
import { locale } from "@originloom/shared/lib/request";

import { pageParam } from "~/lib/pagination";
import { layoutCacheFragment } from "~/lib/shell-data";

/**
 * HTML page cache identities. The purge API and the metrics route labels are
 * derived from this registry, so every cacheable page needs an entry here.
 */
export const PageCacheId = {
  home: "home",
  catalog: "catalog",
  itemDetail: "item-detail",
  account: "account",
  media: "media",
  showcase: "showcase",
} as const;

export type PageCacheId = (typeof PageCacheId)[keyof typeof PageCacheId];

export type PageCacheStrategy = "shared" | "never";

export type PageCacheDefinition = {
  id: PageCacheId;
  description: string;
  path: string;
  strategy: PageCacheStrategy;
  ttl?: number;
  swr?: number;
  buildKey: (ctx: Ctx) => string[];
};

const DEFAULT_TTL = 300;
const DEFAULT_SWR = 3_600;

export const pageCacheRegistry: Record<PageCacheId, PageCacheDefinition> = {
  [PageCacheId.home]: {
    id: PageCacheId.home,
    description: "Ana sayfa",
    path: "/",
    strategy: "shared",
    ttl: 3600,
    // Only normalized values that actually change the HTML belong in the key.
    buildKey: (ctx) => ["home", locale(ctx.request), layoutCacheFragment(ctx)],
  },
  [PageCacheId.catalog]: {
    id: PageCacheId.catalog,
    description: "Katalog (sayfalı)",
    path: "/catalog",
    strategy: "shared",
    // Only the normalized page number changes the HTML, so only it enters the key.
    buildKey: (ctx) => [
      "catalog",
      String(pageParam(ctx.url)),
      locale(ctx.request),
      layoutCacheFragment(ctx),
    ],
  },
  [PageCacheId.itemDetail]: {
    id: PageCacheId.itemDetail,
    description: "Ürün detayı",
    path: "/items/:slug",
    strategy: "shared",
    // The slug fragments the cache — each item gets its own entry.
    buildKey: (ctx) => [
      "item-detail",
      ctx.params.slug ?? "",
      locale(ctx.request),
      layoutCacheFragment(ctx),
    ],
  },
  [PageCacheId.account]: {
    id: PageCacheId.account,
    description: "Hesabım (kişisel — cache'lenmez)",
    path: "/account",
    // Personal page: never written to the shared HTML cache.
    strategy: "never",
    buildKey: () => ["account"],
  },
  [PageCacheId.media]: {
    id: PageCacheId.media,
    description: "Görsel pipeline demosu",
    path: "/media",
    strategy: "shared",
    ttl: 3600,
    buildKey: (ctx) => ["media", locale(ctx.request), layoutCacheFragment(ctx)],
  },
  [PageCacheId.showcase]: {
    id: PageCacheId.showcase,
    description: "Fragment örneği",
    path: "/showcase",
    strategy: "shared",
    // Page cached for an hour; the fragment it embeds has its own 15s TTL.
    ttl: 3600,
    buildKey: (ctx) => ["showcase", locale(ctx.request), layoutCacheFragment(ctx)],
  },
};

/** Route \`cache\` handler — derives the policy from the registry. */
export function pageCachePolicy(id: PageCacheId, ctx: Ctx): CachePolicy {
  const entry = pageCacheRegistry[id];
  if (entry.strategy === "never") return neverCache();

  return sharedUnlessBypass(ctx, entry.buildKey(ctx), {
    ttl: entry.ttl ?? DEFAULT_TTL,
    swr: entry.swr ?? DEFAULT_SWR,
  });
}

export function listPageCachePrefixes(): PageCacheDefinition[] {
  return Object.values(pageCacheRegistry);
}

export function isKnownPageCachePrefix(prefix: string): prefix is PageCacheId {
  return Object.values(PageCacheId).includes(prefix as PageCacheId);
}
`;

const siteDefaults = (
  title,
) => `import type { SiteMetadataConfig } from "@originloom/shared/lib/metadata/types";

/** Static site identity — the metadata engine merges route metadata on top of this. */
export function siteMetadata(baseUrl: string): SiteMetadataConfig {
  return {
    applicationName: "${title}",
    title: {
      default: "${title}",
      template: "%s | ${title}",
    },
    description: "${title} — OriginLoom üzerinde çalışan SSR uygulaması.",
    baseUrl,
    openGraph: {
      siteName: "${title}",
      type: "website",
      locale: "tr_TR",
      defaultImage: \`\${baseUrl}/assets/media/og-default.jpg\`,
    },
    twitter: { card: "summary_large_image" },
    robots: { index: true, follow: true },
    // Both are produced by \`pnpm media\` from server/media.config.json.
    icons: {
      icon: "/assets/media/favicon-32.png",
      apple: "/assets/media/apple-touch-icon.png",
    },
    formatDetection: { telephone: false },
  };
}
`;

const routingRules =
  () => `import type { RedirectRule, RewriteRule } from "@originloom/shared/routing/types";

/**
 * Config-level redirects — the Next.js \`redirects()\` equivalent.
 * Example: { source: "/eski-yol", destination: "/yeni-yol", status: 301 }
 */
export const redirects: RedirectRule[] = [];

/**
 * Internal rewrites and explicit external proxies — the \`rewrites()\` equivalent.
 * Gateway-bound rules go through createRewrites so the host stays configurable.
 */
export const rewrites: RewriteRule[] = [];

export function createRewrites(_gatewayUrl: string): RewriteRule[] {
  return rewrites;
}
`;

const globalsCss = (standalone) => `@import "tailwindcss";

/* The platform packages render utility classes outside this app's own source,
   so Tailwind must scan them too — as workspace source, or as installed dist. */
@source "${standalone ? "../../node_modules/@originloom/react/dist" : "../../../../packages/origin-react/src"}";
@source "${standalone ? "../../node_modules/@originloom/shared/dist" : "../../../../packages/origin-shared/src"}";

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}

body {
  font-family: var(--font-sans);
}
`;

const dockerfile = (name, port, standalone) =>
  standalone ? standaloneDockerfile(name, port) : workspaceDockerfile(name, port);

const workspaceDockerfile = (name, port) => `# Build context is the repository root:
#   docker build -f apps/${name}/Dockerfile -t ${name} .
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter ${name} typecheck && pnpm --filter ${name} build

${dockerfileRunner(name, port, "/repo/apps/" + name + "/dist")}`;

// Standalone build context is the app itself; installing pulls @originloom/*
// from the registry, so the build host needs registry access.
const standaloneDockerfile = (name, port) => `# Build context is this app's root:
#   docker build -t ${name} .
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm typecheck && pnpm build

${dockerfileRunner(name, port, "/app/dist")}`;

const dockerfileRunner = (name, port, distPath) => `FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=${port}

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# The bundled package managers are the image's entire JavaScript dependency
# surface — this container only ever runs \`node\` against a self-contained
# bundle, so they are removed rather than carried along with their CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \\
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# The server bundle is self-contained (ssr.noExternal: true) — no node_modules needed.
COPY --from=builder --chown=nodejs:nodejs ${distPath} ./dist
RUN printf '{"type":"module"}\\n' > package.json

USER nodejs

EXPOSE ${port}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||${port})+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server/index.js"]
`;

const readme = (name, title, port, vitePort, standalone) => `# ${title}

OriginLoom ürün uygulaması. Platform runtime'ı \`@originloom/core\` ve \`@originloom/react\`
paketlerinden gelir; bu repo yalnız route tablosunu, ürün kontratını ve kendi chrome'unu içerir.

## Geliştirme

\`\`\`bash
${
  standalone
    ? `pnpm install                 # @originloom/* registry erişimi gerektirir
pnpm dev`
    : `pnpm install                 # repo kökünden, bir kez
pnpm --filter ${name} dev`
}
\`\`\`

Uygulama \`http://127.0.0.1:${port}\`, client modülleri Vite dev server'dan (\`:${vitePort}\`) gelir.${
  standalone
    ? `\nUpstream gateway'i \`.env.development\` içindeki \`GATEWAY_URL\` ile ayarlayın.`
    : ""
}

## Yapı

| Yol                     | Sorumluluk                                                             |
| ----------------------- | ---------------------------------------------------------------------- |
| \`server/index.ts\`       | Composition root — runtime, routing ve app burada kurulur              |
| \`server/routes/\`        | Route tanımları (loader + cache + Component)                           |
| \`server/product/\`       | Platforma verilen kontrat: runtime, document shell, boundary sayfaları |
| \`server/services/\`      | Server-only veri orkestrasyonu — gateway çağrıları ve payload guard'ları |
| \`mock-gateway/\`        | Geliştirme için sahte upstream; \`pnpm dev\` otomatik başlatır          |
| \`src/features/\`         | Sayfa bileşenleri                                                      |
| \`src/islands/\`          | Client etkileşim noktaları — dosya adı island adıdır                   |
| \`src/lib/cache-keys.ts\` | Sayfa cache registry'si — cache'lenen her sayfa buraya girer           |
| \`src/routing/rules.ts\`  | Redirect / rewrite kuralları                                           |

## Yeni sayfa ekleme

1. \`src/lib/cache-keys.ts\` içine cache tanımı ekle (cache'lenecekse).
2. \`server/routes/<sayfa>.tsx\` içinde \`defineRoute\` ile route'u yaz.
3. \`server/routes/index.ts\` route tablosuna ekle — sıra önemli, ilk eşleşen kazanır.
4. Bileşeni \`src/features/\` altına koy; etkileşim gerekiyorsa \`src/islands/\` + \`<Island />\`.

## Deploy

\`\`\`bash
${
  standalone
    ? `pnpm build                           # dist/client + dist/server/index.js
docker build -t ${name} .`
    : `pnpm --filter ${name} build          # dist/client + dist/server/index.js
docker build -f apps/${name}/Dockerfile -t ${name} .`
}
\`\`\`

Production'da \`SITE_URL\`, \`GATEWAY_URL\`, \`RELEASE_ID\` ve
\`AUTH_REFRESH_COORDINATION_SECRET\` zorunludur. \`RELEASE_ID\` ortak Redis'te cache
namespace'ini de belirler — her uygulamaya kendine ait bir değer verin.
`;

const githubWorkflow = (name) => `name: CI

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: pnpm

      # @originloom/* comes from a private registry. The local .npmrc points at a
      # developer's machine, which CI cannot reach — point it at the real one and
      # give it a token if the registry requires auth.
      #   NPM_CONFIG_REGISTRY: \${{ vars.NPM_REGISTRY_URL }}
      #   NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # typecheck, cycles, lint, format, tests, build and a smoke run against the
      # built server. \`smoke\` starts the mock gateway itself, so nothing external
      # has to be running.
      - name: Verify
        run: pnpm run ci

      - name: Build container
        run: docker build --tag ${name}:\${{ github.sha }} .
`;

const mockGateway = () => `#!/usr/bin/env node
/**
 * Local stand-in for the upstream gateway, so \`pnpm dev\` works before a real one
 * exists. \`origin-dev --gateway\` and \`origin-smoke --gateway\` start it for you.
 *
 * Keep it dumb: fixed data in the shapes the real gateway returns. It is a
 * development fixture, not a second implementation of your backend.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4002);

const ITEMS = [
  { slug: "alpha", name: "Alpha", blurb: "İlk örnek kayıt." },
  { slug: "beta", name: "Beta", blurb: "İkinci örnek kayıt." },
  { slug: "gamma", name: "Gamma", blurb: "Üçüncü örnek kayıt." },
  { slug: "delta", name: "Delta", blurb: "Dördüncü örnek kayıt." },
  { slug: "epsilon", name: "Epsilon", blurb: "Beşinci örnek kayıt." },
  { slug: "zeta", name: "Zeta", blurb: "Altıncı örnek kayıt." },
  { slug: "eta", name: "Eta", blurb: "Yedinci örnek kayıt." },
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", \`http://\${req.headers.host ?? "localhost"}\`);

  if (url.pathname === "/items") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("perPage") ?? 3) || 3));
    const start = (page - 1) * perPage;
    return json(res, 200, { items: ITEMS.slice(start, start + perPage), total: ITEMS.length });
  }

  const detail = /^\\/items\\/([^/]+)$/.exec(url.pathname);
  if (detail) {
    const item = ITEMS.find((entry) => entry.slug === decodeURIComponent(detail[1]));
    return item ? json(res, 200, item) : json(res, 404, { error: "not_found" });
  }

  // Stands in for a consent tool: it executes at once and decides a moment
  // later, which is the case document order cannot express. See
  // server/product/analytics.ts.
  if (url.pathname === "/vendor/consent.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    return res.end(
      'setTimeout(function(){window.__consent=true;dispatchEvent(new Event("consent:ready"));},150);',
    );
  }

  // The real gateway decides who the caller is from the bearer token. Here any
  // token is accepted and none is rejected — enough to exercise both branches of
  // the session flow without a login screen.
  if (url.pathname === "/user/profile") {
    if (!req.headers.authorization) return json(res, 401, { error: "unauthorized" });
    return json(res, 200, { displayName: "Örnek Kullanıcı", initials: "ÖK" });
  }

  return json(res, 404, { error: "not_found" });
});

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

server.listen(PORT, "127.0.0.1", () => {
  if (!process.env.MOCK_GW_QUIET) console.log(\`[mock-gw] http://127.0.0.1:\${PORT}\`);
});
`;

const gatewayContracts =
  () => `import { defineGatewayContract } from "@originloom/core/gateway-payload";

/**
 * This app's gateway endpoints and the largest response each may return.
 *
 * The budget is a safety limit, not an estimate: an upstream that suddenly
 * answers ten times its usual size is a defect, and reading it would be the
 * failure. The platform knows none of these names — every app writes its own.
 */
export const GatewayContracts = {
  items: defineGatewayContract("items", 262_144),
  profile: defineGatewayContract("profile", 16_384),
} as const;
`;

const profileService =
  () => `import { gatewayFetchForRequest } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

export type UserProfile = { displayName: string; initials: string };

/**
 * Three outcomes, not two: "we know you are not signed in" and "we could not
 * find out" are different answers. Collapsing them signs users out whenever the
 * upstream hiccups.
 */
export type UserProfileResult =
  | { kind: "ok"; profile: UserProfile }
  | { kind: "unauthorized" }
  | { kind: "unavailable" };

const INVALID = "Profile gateway returned an invalid payload";

/** \`request\` must already carry Authorization — see @originloom/core/auth/bff. */
export async function fetchUserProfile(request: Request): Promise<UserProfileResult> {
  if (!request.headers.get("authorization")) return { kind: "unauthorized" };

  try {
    const response = await gatewayFetchForRequest(request, "/user/profile");
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "unavailable" };

    const payload = await readGatewayJson(response, GatewayContracts.profile, INVALID);
    const data = requireGatewayPayload(
      GatewayContracts.profile,
      payload,
      isProfilePayload,
      INVALID,
    );
    return {
      kind: "ok",
      profile: {
        displayName: data.displayName,
        initials: data.initials ?? data.displayName.slice(0, 2).toUpperCase(),
      },
    };
  } catch (error) {
    if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
    if (isRequestDeadlineError(error)) throw error;
    return { kind: "unavailable" };
  }
}

function isProfilePayload(
  value: unknown,
): value is { displayName: string; initials?: string } {
  return (
    isRecord(value) &&
    isBoundedString(value.displayName, 200) &&
    (value.initials === undefined || isBoundedString(value.initials, 8))
  );
}
`;

const sessionApi = () => `import {
  authenticateBffRequest,
  challengeBffSession,
  confirmBffSession,
  forceTokenRefresh,
  rejectBffSession,
  withBffAuthCookies,
} from "@originloom/core/auth/bff";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { fetchUserProfile } from "@server/services/profile";
import type { Hono } from "hono";

/**
 * The session BFF: the browser asks "who am I", never "here is my token".
 *
 * Credentials live in HttpOnly cookies, so no script can read them; this
 * endpoint exchanges them for a gateway call and answers with a profile. That
 * is also why personalization comes from here instead of the SSR document —
 * the document is shared cache, and this response is per-user and never stored.
 */
const SESSION_POLICY: PublicApiPolicy = {
  name: "session",
  windowMs: 60_000,
  globalLimit: 5_000,
  ipLimit: 120,
  requireSameOriginMutation: true,
};

export function mountSessionApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/session", async (c) => {
    const request = contextRequest(c);
    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", SESSION_POLICY);
    if (denied) return denied;

    const auth = await authenticateBffRequest(request);
    if (auth.kind === "unavailable") return sessionUnavailable(auth.cookies);
    if (auth.kind === "unauthorized") {
      rejectBffSession(auth.cookies);
      return signedOut(auth.cookies);
    }

    const result = await fetchUserProfile(auth.request);
    // The gateway is the authority: it rejected the token, so the UI hints go
    // too — but the refresh token stays, so the next call can recover.
    if (result.kind === "unauthorized") {
      challengeBffSession(auth.cookies);
      return signedOut(auth.cookies);
    }
    if (result.kind === "unavailable") return sessionUnavailable(auth.cookies);

    confirmBffSession(auth.cookies, result.profile);
    return withBffAuthCookies(json({ signedIn: true, profile: result.profile }), auth.cookies);
  });

  // Called after a client-side 401: mints a new access token from the refresh
  // token so the browser can retry, without ever seeing either.
  app.post("/api/session/refresh", async (c) => {
    const request = contextRequest(c);
    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", SESSION_POLICY);
    if (denied) return denied;

    const refreshed = await forceTokenRefresh(request);
    if (refreshed.kind === "unavailable") return sessionUnavailable(refreshed.cookies);
    if (refreshed.kind === "unauthorized") return signedOut(refreshed.cookies);
    return withBffAuthCookies(json({ signedIn: true }), refreshed.cookies);
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    // Per-user and never shared: no cache may keep this, at any layer.
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

function signedOut(cookies: Parameters<typeof withBffAuthCookies>[1]): Response {
  return withBffAuthCookies(json({ signedIn: false }, 401), cookies);
}

function sessionUnavailable(cookies: Parameters<typeof withBffAuthCookies>[1]): Response {
  return withBffAuthCookies(json({ error: "Oturum servisi kullanılamıyor" }, 503), cookies);
}
`;

const seoRoutes = () => `import { config } from "@originloom/core/config";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountSeoRoutes as mountPlatformSeoRoutes } from "@originloom/core/seo";
import { listItems } from "@server/services/items";
import type { Hono } from "hono";

/**
 * robots.txt and sitemap.xml. The platform owns the mechanics — headers,
 * caching, XML escaping, degradation — and this file owns the content: which
 * URLs exist, and what to serve when the source cannot answer.
 */
export function mountSeo(app: Hono<{ Variables: AppVariables }>): void {
  mountPlatformSeoRoutes(app, {
    siteUrl: config.siteUrl,
    entries: async (signal) => {
      const { items } = await listItems(1, 100, signal);
      return [{ path: "/" }, { path: "/catalog" }, ...items.map((item) => ({ path: \`/items/\${item.slug}\` }))];
    },
    // Served when the gateway is down: a stale sitemap beats no sitemap.
    fallbackEntries: [{ path: "/" }, { path: "/catalog" }],
  });
}
`;

const productMetrics = () => `import {
  counterLines,
  type CounterMap,
  escapeLabel,
  increment,
} from "@originloom/core/metrics/primitives";

/**
 * This app's own metrics, merged into /metrics by the runtime's \`metricSources\`.
 *
 * Keep label values bounded: a label built from user input (a slug, a query, an
 * id) turns one metric into thousands of time series and takes Prometheus down
 * with it. Page type here is a closed set.
 */
const catalogViews: CounterMap = new Map();

export function observeCatalogView(page: number): void {
  // Bucket the page number instead of labelling every value.
  const bucket = page === 1 ? "first" : page <= 5 ? "early" : "deep";
  increment(catalogViews, \`page="\${escapeLabel(bucket)}"\`);
}

export function catalogMetricLines(): string[] {
  return counterLines("app_catalog_views_total", "Catalog page renders by page bucket", catalogViews);
}
`;

const productConfigFile = () => `import { config, numberEnv } from "@originloom/core/config";
import { assertPositiveInteger } from "@originloom/core/config-validation";

/**
 * This app's own environment. The platform reads its own variables (ports,
 * cache, gateway, timeouts); everything specific to this product lives here so
 * there is one place to look — and one place to validate.
 */
export const productConfig = {
  /** Items per catalog page. Part of the cache key, so changing it changes cached HTML. */
  catalogPageSize: numberEnv("CATALOG_PAGE_SIZE", 3),
  /** Shown in the footer; optional in development, required in production. */
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || undefined,
} as const;

export type ProductConfig = typeof productConfig;

/**
 * Runs at startup through \`validateConfig([validateProductConfig])\`. Fail here,
 * loudly, rather than at the first request that needs the value.
 */
export function validateProductConfig(): void {
  assertPositiveInteger("CATALOG_PAGE_SIZE", productConfig.catalogPageSize);
  if (productConfig.catalogPageSize > 100) {
    throw new Error("CATALOG_PAGE_SIZE above 100 would make one page too large to cache well");
  }
  if (config.isProduction && !productConfig.supportEmail) {
    throw new Error("SUPPORT_EMAIL is required in production");
  }
}
`;

const publicItemsApi =
  () => `import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { listItems } from "@server/services/items";
import type { Hono } from "hono";

/**
 * Budget for a publicly reachable endpoint. Both limits are per window: the
 * global one protects the process, the per-IP one keeps a single caller from
 * eating that budget. \`requireSameOriginMutation\` rejects cross-origin writes,
 * which is what a browser CSRF attempt looks like.
 */
const ITEMS_POLICY: PublicApiPolicy = {
  name: "items",
  windowMs: 60_000,
  globalLimit: 600,
  ipLimit: 60,
  requireSameOriginMutation: true,
};

/** A public JSON endpoint — same data as the pages, for clients that are not the page. */
export function mountPublicItemsApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/items", async (c) => {
    const request = contextRequest(c);
    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", ITEMS_POLICY);
    if (denied) return denied;

    const { items, total } = await listItems(1, 20, request.signal);
    return c.json(
      { items, total },
      200,
      // Public and identical for everyone, so it may be cached by intermediaries.
      { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    );
  });
}
`;

const svgrConfig =
  () => `/** SVGR config — \`pnpm icons\` turns src/assets/svg into src/components/icons. */
module.exports = {
  typescript: true,
  icon: true,
  jsxRuntime: "automatic",
  expandProps: "end",
  memo: false,
  prettier: false,
  svgoConfig: {
    plugins: [
      { name: "preset-default", params: { overrides: { removeViewBox: false } } },
      // Inherit the surrounding text colour instead of baking one in.
      { name: "convertColors", params: { currentColor: true } },
    ],
  },
};
`;

const brandMarkSvg =
  () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 7h16" />
  <path d="M4 12h10" />
  <path d="M4 17h7" />
</svg>
`;

const responsiveImageComponent =
  () => `import type { ResponsiveImageData, UnoptimizedImageData } from "@originloom/shared/lib/media";
import type { ImgHTMLAttributes } from "react";

type Props = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height" | "loading" | "decoding" | "fetchPriority" | "sizes"
> & {
  image: ResponsiveImageData;
  /**
   * How wide the image will actually be rendered, per breakpoint. The browser
   * picks a candidate from srcset before layout exists, so without this it
   * assumes full viewport width and downloads the largest file every time.
   */
  sizes: string;
  /** The LCP image: load it eagerly and ask for priority. */
  priority?: boolean;
};

/**
 * \`responsiveImage()\` produced the candidates — locally from the media
 * manifest, or rewritten through IMAGE_TRANSFORM_URL when one is configured.
 * This component only spends them; the same markup works either way.
 */
export function ResponsiveImage({ image, sizes, priority = false, alt, ...props }: Props) {
  return (
    <picture>
      {image.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={sizes} />
      ))}
      <img
        {...props}
        src={image.src}
        srcSet={image.srcSet}
        sizes={sizes}
        // Both are always set: a missing intrinsic size is a layout shift.
        width={image.width}
        height={image.height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </picture>
  );
}

type UnoptimizedProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height" | "loading" | "decoding" | "fetchPriority"
> & {
  image: UnoptimizedImageData;
  priority?: boolean;
};

/**
 * The original file, served as it is: no re-encode, no srcset, no runtime
 * proxy. With IMAGE_CDN_URL set it is prefixed with the CDN; otherwise it comes
 * from this origin. Intrinsic size is still required — the layout shift does
 * not care how the bytes were produced.
 */
export function UnoptimizedImage({ image, priority = false, alt, ...props }: UnoptimizedProps) {
  return (
    <img
      {...props}
      src={image.src}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
    />
  );
}
`;

const heroSvg = (
  title,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="720" viewBox="0 0 1440 720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>
  <rect width="1440" height="720" fill="url(#g)" />
  <text x="96" y="380" font-family="system-ui, sans-serif" font-size="84" font-weight="700" fill="#f8fafc">${title}</text>
  <text x="96" y="452" font-family="system-ui, sans-serif" font-size="34" fill="#cbd5f5">\`pnpm media\` bu kaynaktan avif/webp/jpeg üretir</text>
</svg>
`;

const ogCoverSvg = (
  title,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f172a" />
  <text x="80" y="330" font-family="system-ui, sans-serif" font-size="72" font-weight="700" fill="#f8fafc">${title}</text>
  <text x="80" y="410" font-family="system-ui, sans-serif" font-size="32" fill="#94a3b8">OriginLoom</text>
</svg>
`;

const mediaConfig = () =>
  `${JSON.stringify(
    {
      seoAssets: {
        openGraphSource: "src/assets/images/og-cover.svg",
        brandSource: "src/assets/images/brand-mark.svg",
      },
      images: [
        {
          id: "og-cover",
          source: "src/assets/images/og-cover.svg",
          width: 1200,
          height: 630,
          widths: [600, 1200],
          quality: 78,
        },
        {
          // The home page hero. Widths are the ones the layout actually asks
          // for; generating sizes nobody requests only slows the build down.
          id: "hero",
          source: "src/assets/images/hero.svg",
          width: 1440,
          height: 720,
          widths: [640, 960, 1440],
          quality: 72,
        },
      ],
      // Self-hosted fonts go here; each entry is subsetted and emitted with a
      // hashed filename, then preloaded by the document head.
      fonts: [],
    },
    null,
    2,
  )}\n`;
