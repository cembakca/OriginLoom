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
import {
  compareVersions,
  PROJECT_SCHEMA_VERSION,
  TOOLING_VERSION,
} from "../upgrade/compatibility.mjs";
import { migrations } from "../upgrade/migrations.mjs";

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
 *   templateVersion?: string;
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
  templateVersion = TOOLING_VERSION,
  vitePort = port + VITE_PORT_OFFSET,
  registry,
  withOps = false,
}) {
  // Standalone apps live in their own repo and depend on the published
  // @originloom/* packages; workspace apps sit in apps/<name> and link them
  // via workspace:*. The two modes differ only in how they reach the packages
  // and how they build — the app source they generate is identical.
  const standalone = mode === "standalone";
  return {
    // npm config is not inherited from parent directories, so an app that
    // installs @originloom/* from somewhere other than npmjs carries its own.
    ...(registry ? { ".npmrc": npmrc(registry) } : {}),
    ".originloom/project.json": projectMetadata({
      templateVersion,
      platformRange: mode === "workspace" ? "workspace:*" : version,
      mode,
    }),
    "package.json": packageJson(name, { standalone, version, withOps }),
    ...(standalone ? { "pnpm-workspace.yaml": standalonePnpmWorkspace() } : {}),
    "tsconfig.json": tsconfig(standalone),
    "eslint.config.js": eslintConfig(),
    ".prettierrc.json": asset("prettierrc.json"),
    ".prettierignore": prettierIgnore(),
    "vite.config.ts": viteConfig(vitePort),
    "vite.server.config.ts": viteServerConfig(),
    "vitest.config.ts": vitestConfig(name),
    "playwright.config.ts": playwrightConfig(name, port, metricsPort),
    ".env.development": envDevelopment(name, port, metricsPort, vitePort, true),
    ".env.production": envProduction(port, metricsPort, true),
    "README.md": readme(name, title, port, vitePort, standalone, withOps),
    "docs/auth.md": asset("docs/auth.md"),
    "docs/background-workers.md": asset("docs/background-workers.md"),
    "docs/caching.md": asset("docs/caching.md"),
    "docs/capacity.md": asset("docs/capacity.md"),
    "docs/configuration.md": asset("docs/configuration.md"),
    "docs/dynamic-shell.md": asset("docs/dynamic-shell.md"),
    "docs/features.md": asset("docs/features.md"),
    "docs/links.md": asset("docs/links.md"),
    "docs/middleware.md": asset("docs/middleware.md"),
    "docs/mutations.md": asset("docs/mutations.md"),
    "docs/observability.md": asset("docs/observability.md"),
    "docs/react-query.md": asset("docs/react-query.md"),
    "docs/routing.md": asset("docs/routing.md"),
    "docs/seo.md": asset("docs/seo.md"),
    "docs/supply-chain-security.md": asset("docs/supply-chain-security.md"),
    "docs/streaming.md": asset("docs/streaming.md"),
    "docs/testing.md": asset("docs/testing.md"),
    "docs/contracts.md": asset("docs/contracts.md"),
    "docs/performance.md": asset("docs/performance.md"),
    "docs/performance-acceptance.md": asset("docs/performance-acceptance.md"),
    "docs/runtime-performance.md": asset("docs/runtime-performance.md"),
    "docs/upgrading.md": asset("docs/upgrading.md"),
    Dockerfile: dockerfile(name, port, standalone),
    ".dockerignore": asset("dockerignore"),
    ".gitignore": asset("gitignore"),
    ".nvmrc": asset("nvmrc"),
    ".editorconfig": asset("editorconfig"),
    ".github/workflows/ci.yml": githubWorkflow(name),
    ".github/workflows/dependency-track.yml": dependencyTrackWorkflow(),
    // Opt-in deployment assets: compose, k8s manifests, a load generator.
    ...(withOps ? renderOpsTemplates({ name, port, metricsPort, includeCapacity: true }) : {}),
    "load-test/capacity.mjs": asset("load-test/capacity.mjs"),
    "load-test/capacity-metrics.mjs": asset("load-test/capacity-metrics.mjs"),
    "load-test/capacity-report.mjs": asset("load-test/capacity-report.mjs"),
    "load-test/capacity-scenarios.mjs": asset("load-test/capacity-scenarios.mjs"),
    "load-test/performance-policy.mjs": asset("load-test/performance-policy.mjs"),
    "load-test/performance.mjs": asset("load-test/performance.mjs"),
    "load-test/profile.mjs": asset("load-test/profile.mjs"),
    "load-test/profile-target.mjs": asset("load-test/profile-target.mjs"),

    "server/index.ts": serverIndex("/src/entry.client.tsx"),
    "server/middleware/index.ts": middlewareIndex(),
    "server/middleware/maintenance.ts": maintenanceMiddlewareFile(),
    "server/middleware/redirect-rules.ts": redirectRulesMiddlewareFile(),
    "server/middleware/search-indexing.ts": searchIndexingMiddlewareFile(),
    "server/api/index.ts": apiIndex(),
    "server/api/live-stream/admission.ts": liveStreamAdmission(),
    "server/api/live-stream/index.ts": liveStreamApi(),
    "server/seo.ts": seoRoutes(),
    "server/metrics/catalog.ts": productMetrics(),
    "server/metrics/live-stream.ts": liveStreamMetrics(),
    "server/product/config.ts": productConfigFile(true),
    "server/product/analytics.ts": productAnalytics(),
    "server/api/items.ts": publicItemsApi(),
    "server/api/enquiries.ts": enquiryApi(),
    "server/services/enquiries.ts": enquiryService(),
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
    "server/routes/data-cache.tsx": dataCacheRoute(),
    "server/routes/item-detail.tsx": itemDetailRoute(),
    "server/routes/account.tsx": accountRoute(),
    "server/routes/contact.tsx": contactRoute(),
    "src/features/contact/contact-page.tsx": contactPage(),
    "server/routes/live.tsx": liveRoute(),
    "server/services/shell-data.ts": serverShellData(),
    "server/services/menu.ts": menuService(),
    "server/services/bot-analytics.ts": botAnalyticsService(),
    "server/services/items.ts": itemsService(),
    "server/services/featured-items.ts": featuredItemsService(),
    "server/services/live-message.ts": liveMessageService(),
    "server/services/profile.ts": profileService(),
    "server/services/gateway-contracts.ts": gatewayContracts(true),
    "contracts/openapi.json": gatewayOpenApi(),
    "contracts/gateway-contracts.json": gatewayContractConfig(),
    "contracts/fixtures/items-page.json": gatewayItemsPageFixture(),
    "contracts/fixtures/item.json": gatewayItemFixture(),
    "contracts/fixtures/live-message.json": gatewayLiveMessageFixture(),
    "contracts/fixtures/menu.json": gatewayMenuFixture(),
    "performance-budgets.json": performanceBudgets(),
    "performance-policy.json": performancePolicy(),
    "dependency-track.config.json": dependencyTrackConfig(name),
    "lighthouserc.json": lighthouseConfig(port),
    ".github/workflows/contract-staging.yml": stagingContractWorkflow(name),
    "mock-gateway/server.mjs": mockGateway(true),
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
    "src/features/data-cache/data-cache-page.tsx": dataCachePage(),
    "src/features/items/item-detail-page.tsx": itemDetailPage(),
    "src/features/live/live-page.tsx": livePage(),
    "src/components/layout/root-layout.tsx": rootLayout(title),
    "src/components/ui/responsive-image.tsx": responsiveImageComponent(),
    "src/lib/shell-data.ts": libShellData(),
    "src/lib/cache-keys.ts": cacheKeys(),
    "src/lib/pagination.ts": paginationLib(),
    "src/lib/query/hooks/use-session.ts": sessionQueryHook(),
    "src/lib/query/keys.ts": queryKeys(),
    "src/lib/metadata/site-defaults.ts": siteDefaults(title),
    "src/lib/menu.ts": menuLib(),
    "src/routing/rules.ts": routingRules(true),
    "src/styles/globals.css": globalsCss(standalone),
    "src/global.d.ts": globalDts(),

    "tests/home.test.ts": homeTest(),
    "tests/middleware.test.ts": middlewareTest(),
    "tests/auth-client.test.ts": authClientTest(),
    "tests/live-stream-admission.test.ts": liveStreamAdmissionTest(),
    "tests/live-stream-api.test.ts": liveStreamApiTest(),
    "tests/live-message-service.test.ts": liveMessageServiceTest(),
    "tests/menu-cache.test.ts": menuCacheTest(),
    "tests/featured-items-cache.test.ts": featuredItemsCacheTest(),
    "tests/pagination.test.ts": paginationTest(),
    "tests/bot-analytics.test.ts": botAnalyticsTest(),
    "tests/cache-key-codec.test.ts": cacheKeyCodecTest(),
    "tests/routing-rules.test.ts": routingRulesTest(),
    "tests/session-api.test.ts": sessionApiTest(),
    "tests/enquiries-api.test.ts": enquiryApiTest(),
    "e2e/critical-paths.spec.ts": criticalPathsE2e(port, metricsPort),
    "e2e/accessibility.spec.ts": accessibilityE2e(),
    "e2e/ssr.no-js.spec.ts": noJavaScriptE2e(),

    // Claude Code integration — an always-loaded project guide, a pre-approved
    // permission allowlist, and the skill set. Identical in both modes; the
    // generated app source they describe is too.
    "CLAUDE.md": asset("generated-claude.md"),
    ".claude/settings.json": claudeSettings(),
    ...renderSkills(),
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
          "Bash(pnpm e2e)",
          "Bash(pnpm e2e:*)",
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

/** @param {{ standalone: boolean; version: string }} opts */
const packageJson = (name, { standalone, version, withOps = false }) => {
  // workspace apps link the packages by workspace:*; standalone apps pin the
  // published version range passed via --version.
  const originloom = standalone ? version : "workspace:*";
  // In a workspace, native build scripts are approved once at the repo root
  // (pnpm-workspace.yaml). A standalone repo is its own root, so it must approve
  // the ones its dependency tree pulls in — otherwise pnpm install prints an
  // "Ignored build scripts" warning. Mirrors the platform's trusted set.
  return `${JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      packageManager: "pnpm@11.18.0",
      engines: { node: ">=22.19.0" },
      scripts: {
        "origin:doctor": "origin-doctor",
        "origin:migrate": "origin-migrate",
        sbom: "origin-sbom",
        "sbom:prod": "origin-sbom --prod",
        "dependency-track:publish": "origin-dependency-track publish",
        "dependency-track:gate": "origin-dependency-track gate",
        dev: "origin-dev --gateway mock-gateway/server.mjs",
        "mock-gw": "origin-run-with-env development node mock-gateway/server.mjs",
        build: "origin-build",
        start: "origin-run-with-env production node --enable-source-maps dist/server/index.js",
        "start:dev": "origin-run-with-env development node --import tsx/esm server/index.ts",
        smoke: "origin-smoke --gateway mock-gateway/server.mjs",
        typecheck: "tsc --noEmit",
        "check:cycles": "origin-check-cycles",
        ...{
          capacity: "node load-test/capacity.mjs",
          "capacity:quick": "node load-test/capacity.mjs --profile quick",
          "performance:compare": "node load-test/performance.mjs",
          "performance:accept": "node load-test/performance.mjs --accept",
          "capacity:profile": "node load-test/profile.mjs",
          "contracts:fixtures": "origin-check-contracts",
          "contracts:staging": "origin-check-contracts --require-base-url",
          "budget:bundle": "origin-check-budgets",
          "quality:server": "origin-quality-server --gateway mock-gateway/server.mjs",
          lighthouse: "origin-lighthouse",
        },
        icons: "origin-generate-icons",
        media: "origin-build-media",
        lint: "eslint .",
        "lint:fix": "eslint . --fix",
        format: "prettier --write .",
        "format:check": "prettier --check .",
        // Keep Playwright specs out of Vitest; e2e has its own runner below.
        test: "vitest run tests",
        e2e: "playwright test",
        "e2e:server": "pnpm run build && pnpm run start",
        "e2e:ui": "playwright test --ui",
        "e2e:report": "playwright show-report",
        "e2e:install": "playwright install chromium",
        // Deployment helpers, generated only with --with-ops.
        ...(withOps
          ? {
              "compose:up": "origin-compose-up",
              "compose:redis": "origin-compose-up --redis",
              "compose:clean": "origin-docker-clean",
              "dev:redis": "origin-dev-local",
              "start:local:redis": "origin-run-local production --redis",
              loadtest: "node load-test/run.mjs",
              stress: "node load-test/stress.mjs",
              "loadtest:compare": "node load-test/compare.mjs",
              "pentest:readiness": "node scripts/pentest-readiness.mjs",
            }
          : {}),
        // What CI runs, in one command, so it can be run locally too.
        ci: "pnpm run origin:doctor --strict && pnpm run typecheck && pnpm run check:cycles && pnpm run lint && pnpm run format:check && pnpm run test && pnpm run contracts:fixtures && pnpm run build && pnpm run budget:bundle && pnpm run e2e && pnpm run lighthouse && pnpm run smoke",
      },
      dependencies: {
        "@hono/node-server": "^2.0.12",
        "@originloom/core": originloom,
        "@originloom/shared": originloom,
        "@originloom/react": originloom,
        "@tailwindcss/vite": "^4.3.3",
        "@tanstack/react-query": "^5.101.4",
        "web-vitals": "^6.0.1",
        clsx: "^2.1.1",
        hono: "^4.12.32",
        react: "^19.2.8",
        "react-dom": "^19.2.8",
        tailwindcss: "^4.3.3",
        tsx: "^4.23.1",
      },
      devDependencies: {
        "@eslint/js": "^10.0.1",
        // Vite 8.1.x pins Rolldown 1.1.x whose WASI binding is compatible with
        // wasm-runtime 1.1.6. A direct exact dependency keeps pnpm from selecting
        // wasm-runtime 1.2.x's incompatible @emnapi 2 alpha peer contract.
        "@napi-rs/wasm-runtime": "1.1.6",
        "@originloom/tooling": originloom,
        "@types/node": "^22.20.1",
        "@axe-core/playwright": "^4.12.1",
        "@playwright/test": "^1.62.0",
        "@types/react": "^19.2.17",
        "@types/react-dom": "^19.2.3",
        "@vitejs/plugin-react": "^6.0.4",
        autocannon: "^8.0.0",
        lighthouse: "^13.4.1",
        eslint: "^10.8.0",
        "eslint-config-prettier": "^10.1.8",
        "eslint-plugin-simple-import-sort": "^14.0.0",
        globals: "^17.8.0",
        prettier: "^3.9.6",
        typescript: "^5.9.3",
        "typescript-eslint": "^8.65.0",
        vite: "^8.1.5",
        vitest: "^4.1.10",
      },
    },
    null,
    2,
  )}\n`;
};

const standalonePnpmWorkspace = () => `packages: []

# pnpm 11 denies unreviewed dependency lifecycle scripts. Keep this list small
# and review every addition instead of enabling all builds globally.
allowBuilds:
  "@tailwindcss/oxide": true
  esbuild: true
  protobufjs: true
  sharp: true
  unrs-resolver: true

# Autocannon 8 still declares hyperid 3, which pulls the unsupported uuid 8.
# Hyperid 4 preserves the API and uses randomUUID instead.
overrides:
  autocannon>hyperid: ^4.0.0
`;

const projectMetadata = ({ templateVersion, platformRange, mode }) =>
  JSON.stringify(
    {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      templateVersion,
      platformRange,
      renderer: "react",
      mode,
      generatedBy: "@originloom/tooling",
      appliedMigrations: migrations
        .filter(({ introducedIn }) => compareVersions(introducedIn, templateVersion) <= 0)
        .map(({ id }) => id),
    },
    null,
    2,
  ) + "\n";

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

const tsconfig = (standalone) => {
  const extendsLine = standalone ? "" : `  "extends": "../../tsconfig.base.json",\n`;
  const options = standalone ? BASE_COMPILER_OPTIONS + APP_COMPILER_OPTIONS : APP_COMPILER_OPTIONS;
  return `{
${extendsLine}  "compilerOptions": {
${options}
  },
  "include": ["src", "server", "tests", "e2e", "vite.config.ts", "vite.server.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
`;
};

const eslintConfig = () => `import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
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
playwright-report
test-results
pnpm-lock.yaml
# pnpm owns this file and rewrites it — release-age exclusions, for one — in its
# own style. Formatting it is a fight with the tool that writes it.
pnpm-workspace.yaml
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

const playwrightConfig = (
  name,
  port,
  metricsPort,
) => `import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const useExternalServer = process.env.E2E_EXTERNAL_SERVER === "1";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:${port}";
const mockGatewayPort = Number(process.env.E2E_MOCK_GATEWAY_PORT ?? 4002);
const mockGatewayURL = "http://127.0.0.1:" + mockGatewayPort;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI
    ? [["dot"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/*.no-js.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-no-js",
      testMatch: "**/*.no-js.spec.ts",
      use: { ...devices["Desktop Chrome"], javaScriptEnabled: false },
    },
  ],
  ...(useExternalServer
    ? {}
    : {
        webServer: [
          {
            command: "pnpm run mock-gw",
            url: mockGatewayURL + "/items?perPage=1",
            reuseExistingServer: !isCI,
            timeout: 60_000,
            env: { MOCK_GATEWAY_PORT: String(mockGatewayPort), MOCK_GW_QUIET: "1" },
          },
          {
            command: "pnpm run e2e:server",
            url: baseURL + "/healthz",
            reuseExistingServer: !isCI,
            timeout: 120_000,
            env: {
              NODE_ENV: "production",
              APP_ENV: "production",
              PORT: "${port}",
              METRICS_PORT: "${metricsPort}",
              SITE_URL: baseURL,
              GATEWAY_URL: mockGatewayURL,
              ALLOW_INSECURE_GATEWAY: "true",
              RELEASE_ID: "e2e",
              AUTH_REFRESH_COORDINATION_SECRET: "0123456789abcdef0123456789abcdef",
              CACHE_BACKEND: "memory",
              CACHE_REQUIRED: "false",
              // Browser disconnects become observable on the next write. Keep
              // this suite fast without changing the production default.
              LIVE_STREAM_HEARTBEAT_MS: "250",
            },
          },
        ],
      }),
  metadata: { application: "${name}" },
});
`;

const criticalPathsE2e = (port, metricsPort) => `import { expect, test } from "@playwright/test";

test.describe("SSR and island critical paths", () => {
  test("serves an enforced CSP and hydrates the counter island", async ({ page }) => {
    const clientErrors: string[] = [];
    const cspErrors: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/internal/client-errors")) clientErrors.push(request.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("Content Security Policy")) {
        cspErrors.push(message.text());
      }
    });
    let response = await page.goto("/");

    expect(response?.status()).toBe(200);
    let headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("script-src");
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    expect(headers["x-content-type-options"]).toBe("nosniff");

    // The first anonymous response establishes tracking state, the next fills
    // the shared HTML cache, and the third exercises a cache HIT. Every body
    // must carry the nonce authorized by its own response header.
    for (let visit = 0; visit < 2; visit++) {
      response = await page.goto("/");
      expect(response?.status()).toBe(200);
    }
    headers = response?.headers() ?? {};
    const headerNonce = headers["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1];
    expect(headerNonce).toBeTruthy();
    const scriptNonces = await page.locator("script[nonce]").evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce),
    );
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(new Set(scriptNonces)).toEqual(new Set([headerNonce]));

    const counter = page.getByRole("button", { name: "Tıklandı: 0" });
    await expect(counter).toBeVisible();
    await expect(page.locator('[data-island="counter"]')).toHaveAttribute("data-hydrated", "");
    await counter.click();
    await expect(page.getByRole("button", { name: "Tıklandı: 1" })).toBeVisible();
    expect(clientErrors).toEqual([]);
    expect(cspErrors).toEqual([]);
  });

  test("keeps redirect query parameters and preserves the public rewrite URL", async ({
    page,
    request,
  }) => {
    const redirect = await request.get("/old-catalog?source=e2e", { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    const locationHeader = redirect.headers().location;
    if (!locationHeader) throw new Error("Redirect response is missing Location");
    const location = new URL(locationHeader);
    expect(location.pathname + location.search).toBe("/catalog?source=e2e");

    await page.goto("/old-catalog?source=e2e");
    await expect(page).toHaveURL(/\\/catalog\\?source=e2e$/);
    await expect(page.getByRole("heading", { name: "Katalog" })).toBeVisible();

    await page.goto("/products/alpha?source=e2e");
    await expect(page).toHaveURL(/\\/products\\/alpha\\?source=e2e$/);
    await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  });

  test("refreshes a challenged session once and retries the profile request", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: "refresh_token", value: "dev-refresh-token", url: "http://127.0.0.1:${port}" },
    ]);

    let sessionCalls = 0;
    await page.route("**/api/session", async (route) => {
      sessionCalls++;
      if (sessionCalls === 1) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ signedIn: false }),
        });
        return;
      }
      await route.continue();
    });

    const refresh = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/internal/refresh") && response.request().method() === "POST",
    );
    await page.goto("/account");

    expect((await refresh).status()).toBe(200);
    await expect(page.getByText("Merhaba Örnek Kullanıcı")).toBeVisible();
    expect(sessionCalls).toBe(2);
  });

  test("shows the React Query error state and allows an explicit retry", async ({ page }) => {
    let sessionCalls = 0;
    await page.route("**/api/session", async (route) => {
      sessionCalls++;
      if (sessionCalls <= 2) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporary_failure" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: { displayName: "E2E Kullanıcı", initials: "E2E" } }),
      });
    });

    await page.goto("/account");
    await expect(page.getByText("Oturum bilgisi şu an alınamıyor.")).toBeVisible();
    expect(sessionCalls).toBe(2);

    await page.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(page.getByText("Merhaba E2E Kullanıcı")).toBeVisible();
    expect(sessionCalls).toBe(3);
  });

  test("renders HTML again while reusing the public API data snapshot", async ({ page }) => {
    const firstResponse = await page.goto("/data-cache");
    expect(firstResponse?.headers()["x-cache"]).toBe("BYPASS");
    const firstRenderedAt = await page.getByTestId("page-rendered-at").textContent();
    const firstFetchedAt = await page.getByTestId("api-fetched-at").textContent();

    await page.waitForTimeout(10);
    const secondResponse = await page.reload();
    expect(secondResponse?.headers()["x-cache"]).toBe("BYPASS");
    await expect(page.getByTestId("api-cache-status")).toContainText("FRESH");
    await expect(page.getByTestId("page-rendered-at")).not.toHaveText(firstRenderedAt ?? "");
    await expect(page.getByTestId("api-fetched-at")).toHaveText(firstFetchedAt ?? "");
  });

  test("opens the SSE stream and releases its server-side lease on navigation", async ({
    page,
    request,
  }) => {
    const activeConnections = async () => {
      const response = await request.get("http://127.0.0.1:${metricsPort}/metrics");
      expect(response.ok()).toBe(true);
      const match = (await response.text()).match(/app_live_stream_active_connections (\\d+)/);
      return Number(match?.[1] ?? -1);
    };

    await page.goto("/live");
    await expect(page.getByText(/Sunucudan geç gelen değer:/)).toContainText(
      /\\d{4}-\\d{2}-\\d{2}T/,
    );
    await expect(page.getByText(/Son tick:/)).toContainText(/\\d{4}-\\d{2}-\\d{2}T/);
    await expect.poll(activeConnections).toBe(1);

    await page.goto("/catalog");
    await expect.poll(activeConnections).toBe(0);
  });

  test("keeps HttpOnly credentials out of the SSR document", async ({ context, page }) => {
    const secret = "browser-visible-secret-must-not-leak";
    await context.addCookies([
      { name: "access_token", value: secret, url: "http://127.0.0.1:${port}" },
      { name: "refresh_token", value: "dev-refresh-token", url: "http://127.0.0.1:${port}" },
    ]);

    const response = await page.goto("/account");
    expect(await response?.text()).not.toContain(secret);
    await expect(page.getByRole("heading", { name: "Hesabım" })).toBeVisible();
  });
});
`;

const accessibilityE2e = () => `import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of ["/", "/catalog", "/data-cache", "/account"] as const) {
  test(\`\${path} has no serious or critical accessibility violations\`, async ({ page }) => {
    await page.goto(path);
    await page.locator("main").waitFor();
    const islands = page.locator("[data-island]");
    for (let index = 0; index < (await islands.count()); index++) {
      await expect(islands.nth(index)).toHaveAttribute("data-hydrated", "");
    }

    const results = await new AxeBuilder({ page }).include("main").analyze();
    const violations = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
}
`;

const noJavaScriptE2e = () => `import { expect, test } from "@playwright/test";

test("catalog remains usable when JavaScript is disabled", async ({ page }) => {
  const response = await page.goto("/catalog?page=1");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Katalog" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alpha" })).toBeVisible();
  await expect(page.getByText("Sayfa 1 / 3")).toBeVisible();

  await page.getByRole("link", { name: "Alpha" }).click();
  await expect(page).toHaveURL(/\\/items\\/alpha$/);
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
});

test("the contact form submits and reports back without JavaScript", async ({ page }) => {
  await page.goto("/contact");

  await page.getByLabel("Adınız").fill("Ada");
  await page.getByLabel("E-posta").fill("ada@example.com");
  await page.getByLabel("Mesajınız").fill("Merhaba");
  await page.getByRole("button", { name: "Gönder" }).click();

  // Post/Redirect/Get: the browser ends up on a GET it can reload safely.
  await expect(page).toHaveURL(/\\/contact\\?status=sent$/);
  await expect(page.getByRole("status")).toContainText("Mesajınız alındı");
});
`;

const liveStreamEnv = `LIVE_STREAM_MAX_CONNECTIONS=1000
LIVE_STREAM_MAX_CONNECTIONS_PER_IP=5
LIVE_STREAM_MAX_DURATION_MS=300000
LIVE_STREAM_HEARTBEAT_MS=15000
`;
const liveStreamProductionEnv = `# Long-lived connection budgets. Tune these from load tests; do not remove them.
${liveStreamEnv}`;
const botAnalyticsEnv = `BOT_ANALYTICS_QUEUE_CAPACITY=1000
BOT_ANALYTICS_BATCH_SIZE=25
BOT_ANALYTICS_FLUSH_MS=250
BOT_ANALYTICS_DRAIN_TIMEOUT_MS=3000
`;
const menuCacheEnv = `MENU_CACHE_TTL=14400
MENU_CACHE_SWR=86400
FEATURED_ITEMS_CACHE_TTL=10
FEATURED_ITEMS_CACHE_SWR=30
`;

const envDevelopment = (
  name,
  port,
  metricsPort,
  vitePort,
  includeLiveStream = false,
) => `NODE_ENV=development
APP_ENV=development
PORT=${port}
METRICS_PORT=${metricsPort}
SITE_URL=http://127.0.0.1:${port}
VITE_DEV_SERVER_URL=http://127.0.0.1:${vitePort}

# L1-only cache; no Redis needed for local development.
CACHE_BACKEND=memory
CACHE_REQUIRED=false

# Upstream API. The mock owns its port; it never reuses the app's PORT value.
MOCK_GATEWAY_PORT=4002
GATEWAY_URL=http://127.0.0.1:4002
ALLOW_INSECURE_GATEWAY=true

# This app's own settings — see server/product/config.ts, validated at startup.
CATALOG_PAGE_SIZE=3
${includeLiveStream ? menuCacheEnv + liveStreamEnv + botAnalyticsEnv : ""}
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
# GATEWAY_CONNECT_TIMEOUT_MS=1000
# GATEWAY_HEADERS_TIMEOUT_MS=5000
# GATEWAY_BODY_TIMEOUT_MS=5000
# GATEWAY_MAX_CONNECTIONS=64
# GATEWAY_PIPELINING=1
# GATEWAY_KEEP_ALIVE_TIMEOUT_MS=10000
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
# HTTP_COMPRESSION_THRESHOLD_BYTES=1024
#
# Successful access logs are deterministically sampled in production. Errors
# are always logged; debug disables per-event client metric JSON by default.
# LOG_LEVEL=info
# REQUEST_LOG_SAMPLE_RATE=0.1
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

const envProduction = (port, metricsPort, includeLiveStream = false) => `NODE_ENV=production
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

${includeLiveStream ? menuCacheEnv + liveStreamProductionEnv + botAnalyticsEnv : ""}

# Single-pod L1 cache. For a shared L2 cache across pods switch to redis and set
# REDIS_URL; CACHE_REQUIRED=true makes readiness fail when Redis is unreachable.
CACHE_BACKEND=memory
CACHE_REQUIRED=false
# Gateway transport: bounded keep-alive pool; the platform does not retry
# automatically, so a failing upstream cannot create a retry storm.
GATEWAY_MAX_CONNECTIONS=64
GATEWAY_PIPELINING=1
GATEWAY_CONNECT_TIMEOUT_MS=1000
GATEWAY_HEADERS_TIMEOUT_MS=5000
GATEWAY_BODY_TIMEOUT_MS=5000
GATEWAY_KEEP_ALIVE_TIMEOUT_MS=10000

# Runtime delivery and observability cost controls.
HTTP_COMPRESSION_THRESHOLD_BYTES=1024
LOG_LEVEL=info
REQUEST_LOG_SAMPLE_RATE=0.1
# CACHE_BACKEND=redis
# REDIS_URL=rediss://cache.internal:6379
`;

/**
 * The composition root. Only the subsystems the renderer's file map actually
 * ships may be imported here: a template that boots something it did not
 * generate fails the generated app's own typecheck.
 *
 * @param {string} clientEntry Dev-server path of this app's client entry module.
 * @param {{ liveStream?: boolean; botAnalytics?: boolean }} shipped
 */
const serverIndex = (
  clientEntry,
  { liveStream = true, botAnalytics = true } = {},
) => `import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { mountCachePurgeApi } from "@originloom/core/api/cache-purge";
import { createApp } from "@originloom/core/app";
import { readAssets } from "@originloom/core/assets";
import { cacheTopology, closeCache, initCache } from "@originloom/core/cache";
import { config, validateConfig } from "@originloom/core/config";
import { closeGatewayTransport } from "@originloom/core/gateway-transport";
import { drainRevalidations } from "@originloom/core/handler";
import { register, shutdownInstrumentation } from "@originloom/core/instrumentation";
import { logError, logger } from "@originloom/core/logger";
import { createMetricsApp } from "@originloom/core/metrics-server";
import { configureRouting } from "@originloom/shared/routing";
import { validateRoutingRules } from "@originloom/shared/routing/validate";

import { createRewrites, redirects, rewrites } from "~/routing/rules";

import { mountApi } from "./api";
${liveStream ? 'import { stopLiveStreams } from "./api/live-stream";\n' : ""}import { productMiddleware } from "./middleware";
import { analyticsCsp } from "./product/analytics";
import { validateProductConfig } from "./product/config";
import { installProductRuntime } from "./product/runtime";
import { routes } from "./routes";
import { mountSeo } from "./seo";
${botAnalytics ? 'import { drainBotAnalytics } from "./services/bot-analytics";\n' : ""}
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
    // This app's own request rules — maintenance, indexing, locale, experiments.
    // They run around the platform's auth/session/redirect steps, never instead
    // of them. See docs/middleware.md.
    middleware: productMiddleware,
${
  liveStream
    ? `    // /api/ticks streams until the client leaves, so it manages its own
    // lifetime — arming a request deadline on it would cut a healthy stream.
    longLivedRoutes: ["/api/ticks"],
`
    : ""
}    // Origins the document reaches that are not this app's own.
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
${liveStream ? "    stopLiveStreams();\n" : ""}
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
${botAnalytics ? "          drainBotAnalytics(),\n" : ""}        ]);
        // Drain work may issue gateway requests; close its shared pool last.
        await closeGatewayTransport();
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

const redirectRulesMiddlewareFile =
  () => `import { gatewayFetch, releaseGatewayResponse } from "@originloom/core/adapters/gateway";
import { readGatewayJson } from "@originloom/core/gateway-payload";
import { logger } from "@originloom/core/logger";
import { defineMiddleware, type MiddlewareRedirect } from "@originloom/core/middleware";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import { isRecord } from "@originloom/shared/lib/runtime-schema";
import { GatewayContracts } from "@server/services/gateway-contracts";

/**
 * Asks a service what to do with the URL a visitor asked for, before the page is
 * matched: it either names a destination, or says to carry on.
 *
 * Why a service instead of src/routing/rules.ts: those rules ship with a deploy.
 * These come from whoever curates the site's history — a CMS, an SEO tool — and
 * change without one.
 */
export const redirectRulesMiddleware = defineMiddleware({
  name: "redirect-rules",
  // Nothing has read a token or written a cookie yet: a URL that moved should not
  // cost a session refresh on the way to a 301.
  phase: "before-auth",
  // Every document, and only documents. An endpoint is not a page and has no
  // redirect rules to look up, so it must not pay for this call.
  matcher: ["/:path*"],
  exclude: ["/api/:path*"],
  handler: async (ctx) => {
    const rule = await decide(ctx.url, ctx.request.signal);
    // No rule is the common case: return nothing and the request carries on to
    // auth, session and the route it was always going to render.
    return rule ? { redirect: rule } : undefined;
  },
});

/** The closed set a redirect may carry; anything else the service invents is not obeyed. */
const REDIRECT_STATUS = [301, 302, 303, 307, 308] as const;

/**
 * One lookup per URL per minute, not one per request. Without this every page
 * view pays a gateway round trip before it may render — the platform's own CMS
 * redirect step caches for the same reason (REDIRECT_CACHE_TTL_MS).
 *
 * Keyed by the whole URL because that is what the service is asked about;
 * keying by anything narrower would answer one URL with another URL's rule. If
 * your rules only ever depend on the path — the common case — ask with the path
 * and key by it, so query strings cannot push entries out of a bounded cache.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1_000;
const cache = new Map<string, { value: MiddlewareRedirect | null; expiresAt: number }>();

async function decide(url: URL, signal: AbortSignal): Promise<MiddlewareRedirect | null> {
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const response = await gatewayFetch(
      \`/routing/decide?url=\${encodeURIComponent(url.toString())}\`,
      { signal },
    );
    if (!response.ok) {
      await releaseGatewayResponse(response);
      // An unanswered lookup is not "no rule": do not cache it as one.
      return null;
    }
    const payload = await readGatewayJson(
      response,
      GatewayContracts.routing,
      "Routing gateway returned an invalid payload",
    );
    return remember(key, parseDecision(payload));
  } catch (error) {
    // The deadline is the platform's to answer; everything else fails open,
    // because a routing service being down must not take the site down with it.
    if (isRequestDeadlineError(signal.reason)) throw signal.reason;
    if (isRequestDeadlineError(error)) throw error;
    logger.warn("routing decision unavailable", {
      pathname: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Gateway JSON is untrusted input: a status it invents must never reach a Response. */
function parseDecision(payload: unknown): MiddlewareRedirect | null {
  if (!isRecord(payload) || payload.action !== "redirect") return null;
  if (typeof payload.location !== "string" || !sameSite(payload.location)) return null;
  const status = REDIRECT_STATUS.find((allowed) => allowed === payload.status) ?? 307;
  return { location: payload.location, status };
}

/**
 * Same-site destinations only. A rules service that can point visitors at any
 * host is an open redirect with a nice API; sending them off-site is a decision
 * this app should make on purpose, against a list it owns.
 */
function sameSite(location: string): boolean {
  return (
    location.startsWith("/") && !location.startsWith("//") && location.length <= 2_048
  );
}

function remember(key: string, value: MiddlewareRedirect | null): MiddlewareRedirect | null {
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
`;

const middlewareIndex = () => `import type { OriginMiddleware } from "@originloom/core/middleware";

import { maintenanceMiddleware } from "./maintenance";
import { redirectRulesMiddleware } from "./redirect-rules";
import { searchIndexingMiddleware } from "./search-indexing";

/**
 * This app's middleware, in the order they run inside their phase.
 *
 * The platform's own steps — auth, session, CMS redirects — are not in this list
 * and cannot be reordered. A middleware only declares whether it belongs before
 * them ("before-auth") or after them ("before-render", the default).
 *
 * They run on document requests. Mounted API routes are not covered: give those
 * a Hono app.use() inside server/api/index.ts.
 */
export const productMiddleware: readonly OriginMiddleware[] = [
  maintenanceMiddleware,
  redirectRulesMiddleware,
  searchIndexingMiddleware,
];
`;

const maintenanceMiddlewareFile =
  () => `import { defineMiddleware } from "@originloom/core/middleware";

/**
 * Planned maintenance, decided per request rather than at import time: an
 * operator flips the env on the running deployment and the very next request
 * sees it, without waiting for a rollout.
 *
 * It sits in "before-auth" because a closed site should not be refreshing
 * tokens, writing session cookies or calling the gateway on the way to a 503.
 */
export const maintenanceMiddleware = defineMiddleware({
  name: "maintenance",
  phase: "before-auth",
  handler: () => {
    const retryAfter = maintenanceState();
    if (retryAfter === null) return;
    return { response: maintenanceResponse(retryAfter) };
  },
});

/** Seconds to ask clients to wait, or null when the site is open. */
function maintenanceState(): number | null {
  const flag = process.env.MAINTENANCE_MODE?.trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return null;
  const retryAfter = Number(process.env.MAINTENANCE_RETRY_AFTER_SECONDS ?? 120);
  return Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : 120;
}

function maintenanceResponse(retryAfterSeconds: number): Response {
  return new Response(maintenancePage(), {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": String(retryAfterSeconds),
      // A 503 is heuristically cacheable. Nothing in front of the app may keep
      // serving it after maintenance ends.
      "cache-control": "private, no-store",
    },
  });
}

function maintenancePage(): string {
  return (
    "<!DOCTYPE html>" +
    '<html lang="tr">' +
    '<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    "<title>Bakım çalışması</title></head>" +
    '<body><main style="max-width:480px;margin:4rem auto;font-family:system-ui">' +
    "<h1>Kısa bir bakım çalışması yapıyoruz</h1>" +
    "<p>Site birazdan tekrar açılacak. Lütfen daha sonra yeniden deneyin.</p>" +
    "</main></body></html>"
  );
}
`;

const searchIndexingMiddlewareFile = () => `import { config } from "@originloom/core/config";
import { defineMiddleware } from "@originloom/core/middleware";

/**
 * Keep non-production deployments out of search results.
 *
 * robots.txt cannot do this job alone: it asks crawlers not to fetch a page, not
 * to drop one they already know. X-Robots-Tag travels with every document
 * response, including the ones a crawler reached from an external link, and it
 * is a response header rather than markup, so one cached HTML body stays correct
 * for every environment that serves it.
 */
export const searchIndexingMiddleware = defineMiddleware({
  name: "search-indexing",
  handler: () => {
    if (config.appEnv === "production") return;
    return { responseHeaders: { "x-robots-tag": "noindex, nofollow" } };
  },
});
`;

const middlewareTest = () => `import type {
  MiddlewareContext,
  MiddlewareResult,
  OriginMiddleware,
} from "@originloom/core/middleware";
import { maintenanceMiddleware } from "@server/middleware/maintenance";
import { redirectRulesMiddleware } from "@server/middleware/redirect-rules";
import { searchIndexingMiddleware } from "@server/middleware/search-indexing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetch: vi.fn(), releaseGatewayResponse: vi.fn() }));

vi.mock("@originloom/core/adapters/gateway", () => ({
  gatewayFetch: mocks.gatewayFetch,
  releaseGatewayResponse: mocks.releaseGatewayResponse,
}));
vi.mock("@originloom/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** A middleware is a function of its context — build one and call it directly. */
function context(url = "http://app.local/"): MiddlewareContext {
  const request = new Request(url);
  const parsed = new URL(url);
  return {
    request,
    url: parsed,
    publicPath: parsed.pathname,
    params: {},
    clientIp: "127.0.0.1",
    values: {},
    cookie: () => undefined,
    header: (name) => request.headers.get(name) ?? undefined,
  };
}

/** A handler may return nothing at all, so the "did nothing" case is narrowed once here. */
async function run(middleware: OriginMiddleware, ctx = context()) {
  return (await middleware.handler(ctx)) as MiddlewareResult | undefined;
}

describe("maintenance middleware", () => {
  afterEach(() => {
    delete process.env.MAINTENANCE_MODE;
    delete process.env.MAINTENANCE_RETRY_AFTER_SECONDS;
  });

  it("stays out of the way while the site is open", async () => {
    expect(await run(maintenanceMiddleware)).toBeUndefined();
  });

  it("closes the site with a retry hint no cache may keep", async () => {
    process.env.MAINTENANCE_MODE = "1";
    process.env.MAINTENANCE_RETRY_AFTER_SECONDS = "300";

    const result = await run(maintenanceMiddleware);

    expect(result?.response?.status).toBe(503);
    expect(result?.response?.headers.get("retry-after")).toBe("300");
    expect(result?.response?.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("search indexing middleware", () => {
  it("keeps a non-production deployment out of the index", async () => {
    // Tests never run with APP_ENV=production, so this is the off-production path.
    const result = await run(searchIndexingMiddleware);

    expect(result?.responseHeaders?.["x-robots-tag"]).toBe("noindex, nofollow");
  });
});

describe("redirect rules middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseGatewayResponse.mockResolvedValue(undefined);
  });

  // Each case uses its own path: the middleware caches a decision per pathname.
  it("obeys a destination the service names", async () => {
    mocks.gatewayFetch.mockResolvedValue(
      Response.json({ action: "redirect", location: "/catalog", status: 301 }),
    );

    const result = await run(redirectRulesMiddleware, context("http://app.local/moved"));

    expect(result?.redirect).toEqual({ location: "/catalog", status: 301 });
    expect(mocks.gatewayFetch).toHaveBeenCalledWith(
      "/routing/decide?url=" + encodeURIComponent("http://app.local/moved"),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("carries on when the service says next", async () => {
    mocks.gatewayFetch.mockResolvedValue(Response.json({ action: "next" }));

    expect(await run(redirectRulesMiddleware, context("http://app.local/stays"))).toBeUndefined();
  });

  it("refuses a destination that would send visitors off-site", async () => {
    mocks.gatewayFetch.mockResolvedValue(
      Response.json({ action: "redirect", location: "https://evil.example/x" }),
    );

    expect(await run(redirectRulesMiddleware, context("http://app.local/offsite"))).toBeUndefined();
  });

  it("renders the page when the routing service is down", async () => {
    mocks.gatewayFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await run(redirectRulesMiddleware, context("http://app.local/down"))).toBeUndefined();
  });

  it("does not spend a lookup on the API surface", () => {
    // The matcher is the guard: an endpoint is not a page and has no rule.
    expect(redirectRulesMiddleware.matcher).toEqual(["/:path*"]);
    expect(redirectRulesMiddleware.exclude).toEqual(["/api/:path*"]);
  });
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
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<MediaPageData>({
  path: "/media",
  cache: pageCache(PageCacheId.media),
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
import contact from "./contact";
import dataCache from "./data-cache";
import home from "./home";
import itemDetail from "./item-detail";
import live from "./live";
import media from "./media";
import showcase from "./showcase";

/** The route table. Order matters: the first match wins. */
export const routes: Route[] = [
  home,
  catalog,
  dataCache,
  itemDetail,
  account,
  contact,
  live,
  media,
  showcase,
];
`;

const homeRoute = (title) => `import { responsiveImage } from "@originloom/core/media";
import { defineRoute } from "@originloom/react/lib/types";
import type { ResponsiveImageData } from "@originloom/shared/lib/media";
import { imagePreload } from "@originloom/shared/lib/media";

import { HERO_SIZES, HomePage } from "~/features/home/home-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { greeting: string; hero: ResponsiveImageData };

export default defineRoute<Data>({
  path: "/",
  cache: pageCache(PageCacheId.home),
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
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { renderedAt: string };

export default defineRoute<Data>({
  path: "/showcase",
  cache: pageCache(PageCacheId.showcase),
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

const menuCacheTest = () => `import { getMenu } from "@server/services/menu";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  deleteKey: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@originloom/core/adapters/gateway", () => ({
  gatewayFetch: mocks.gatewayFetch,
  requireGatewayOk: async (response: Response, message: string) => {
    if (!response.ok) throw new Error(\`\${message} \${response.status}\`);
  },
}));
vi.mock("@originloom/core/cache", () => ({
  cacheKey: (policy: { key: string[] }) => policy.key.join("\\0"),
  read: mocks.read,
  write: mocks.write,
  deleteKey: mocks.deleteKey,
}));
vi.mock("@originloom/core/logger", () => ({ logger: { warn: mocks.warn } }));

const menu = [{ label: "Katalog", href: "/catalog" }];

describe("menu data cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(null);
    mocks.write.mockResolvedValue(true);
    mocks.deleteKey.mockResolvedValue(true);
    mocks.gatewayFetch.mockResolvedValue(Response.json(menu));
  });

  it("serves a fresh cache hit without calling the gateway", async () => {
    mocks.read.mockResolvedValue({ body: JSON.stringify(menu), state: "fresh" });

    await expect(getMenu(new Request("http://app.local/"))).resolves.toEqual(menu);
    expect(mocks.gatewayFetch).not.toHaveBeenCalled();
  });

  it("fills the shared cache after a cold miss", async () => {
    await expect(getMenu(new Request("http://app.local/"))).resolves.toEqual(menu);

    expect(mocks.gatewayFetch).toHaveBeenCalledWith("/menu");
    expect(mocks.write).toHaveBeenCalledWith(
      "menu:public:v1",
      JSON.stringify(menu),
      expect.objectContaining({ kind: "shared", key: ["menu:public:v1"] }),
    );
  });

  it("returns stale data immediately and coalesces background refreshes", async () => {
    const stale = [{ label: "Eski katalog", href: "/catalog" }];
    mocks.read.mockResolvedValue({ body: JSON.stringify(stale), state: "stale" });

    await expect(
      Promise.all([
        getMenu(new Request("http://app.local/one")),
        getMenu(new Request("http://app.local/two")),
      ]),
    ).resolves.toEqual([stale, stale]);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    expect(mocks.gatewayFetch).toHaveBeenCalledOnce();
  });

  it("does not cache the local fallback when the gateway fails", async () => {
    mocks.gatewayFetch.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(getMenu(new Request("http://app.local/"))).resolves.toContainEqual({
      label: "Ana sayfa",
      href: "/",
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
`;

const featuredItemsCacheTest =
  () => `import { getFeaturedItems } from "@server/services/featured-items";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteKey: vi.fn(),
  listItems: vi.fn(),
  read: vi.fn(),
  warn: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@originloom/core/cache", () => ({
  cacheKey: (policy: { key: string[] }) => policy.key.join("\\0"),
  deleteKey: mocks.deleteKey,
  read: mocks.read,
  write: mocks.write,
}));
vi.mock("@originloom/core/logger", () => ({ logger: { warn: mocks.warn } }));
vi.mock("@server/services/items", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/services/items")>()),
  listItems: mocks.listItems,
}));

const page = {
  items: [
    {
      slug: "alpha",
      name: "Alpha",
      blurb: "İlk örnek kayıt.",
      seo: { title: "Alpha", description: "Alpha detay sayfası." },
    },
  ],
  total: 1,
};

describe("featured items API data cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteKey.mockResolvedValue(true);
    mocks.listItems.mockResolvedValue(page);
    mocks.read.mockResolvedValue(null);
    mocks.write.mockResolvedValue(true);
  });

  it("serves a fresh snapshot without calling the gateway service", async () => {
    const snapshot = { ...page, fetchedAt: "2026-01-01T00:00:00.000Z" };
    mocks.read.mockResolvedValue({ body: JSON.stringify(snapshot), state: "fresh" });

    await expect(getFeaturedItems(new Request("http://app.local/data-cache"))).resolves.toEqual({
      ...snapshot,
      cacheStatus: "fresh",
    });
    expect(mocks.listItems).not.toHaveBeenCalled();
  });

  it("fills the shared data cache after a cold miss", async () => {
    const result = await getFeaturedItems(new Request("http://app.local/data-cache"));

    expect(result).toMatchObject({ ...page, cacheStatus: "miss" });
    expect(result.fetchedAt).toEqual(expect.any(String));
    expect(mocks.listItems).toHaveBeenCalledWith(1, 3);
    expect(mocks.write).toHaveBeenCalledWith(
      "items:featured:v1",
      expect.any(String),
      expect.objectContaining({ kind: "shared", key: ["items:featured:v1"] }),
    );
  });

  it("returns stale data immediately and coalesces background refreshes", async () => {
    const snapshot = { ...page, fetchedAt: "2026-01-01T00:00:00.000Z" };
    mocks.read.mockResolvedValue({ body: JSON.stringify(snapshot), state: "stale" });

    await expect(
      Promise.all([
        getFeaturedItems(new Request("http://app.local/data-cache?one")),
        getFeaturedItems(new Request("http://app.local/data-cache?two")),
      ]),
    ).resolves.toEqual([
      { ...snapshot, cacheStatus: "stale" },
      { ...snapshot, cacheStatus: "stale" },
    ]);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    expect(mocks.listItems).toHaveBeenCalledOnce();
  });

  it("deletes an invalid cache entry before refilling it", async () => {
    mocks.read.mockResolvedValue({ body: '{"items":"invalid"}', state: "fresh" });

    await expect(
      getFeaturedItems(new Request("http://app.local/data-cache")),
    ).resolves.toMatchObject({ cacheStatus: "miss" });
    expect(mocks.deleteKey).toHaveBeenCalledWith("items:featured:v1");
    expect(mocks.listItems).toHaveBeenCalledOnce();
  });
});
`;

const paginationTest = () => `import { describe, expect, it } from "vitest";

import { normalizePageParam } from "~/lib/pagination";

describe("pagination cache normalization", () => {
  it.each([null, "", "0", "1", "nope"])("normalizes %s to the first page", (value) => {
    expect(normalizePageParam(value)).toBe("1");
  });

  it("keeps a valid page in canonical integer form", () => {
    expect(normalizePageParam("02")).toBe("2");
  });
});
`;

const routingRulesTest =
  () => `import { resolveRouteWith } from "@originloom/shared/routing/resolve";
import { describe, expect, it } from "vitest";

import { createRewrites, redirects, rewrites } from "~/routing/rules";

describe("routing rules", () => {
  it("redirects a retired public URL and preserves its query string", () => {
    const result = resolveRouteWith(new URL("https://example.com/old-catalog?source=legacy"), {
      redirects,
      rewrites,
    });

    expect(result).toEqual({
      kind: "redirect",
      url: "https://example.com/catalog?source=legacy",
      status: 308,
    });
  });

  it("rewrites a public alias without changing its browser-visible identity", () => {
    const result = resolveRouteWith(new URL("https://example.com/products/alpha?campaign=spring"), {
      redirects,
      rewrites,
    });

    expect(result).toEqual({
      kind: "rewrite",
      pathname: "/items/alpha",
      search: "?campaign=spring",
      publicPath: "/products/alpha",
    });
  });

  it("proxies only the explicitly exposed gateway endpoint", () => {
    const result = resolveRouteWith(new URL("https://example.com/gateway/menu?locale=tr"), {
      redirects,
      rewrites: createRewrites("http://gateway.internal:4002"),
    });

    expect(result).toEqual({
      kind: "proxy",
      url: "http://gateway.internal:4002/menu?locale=tr",
    });
  });
});
`;

const liveStreamAdmissionTest =
  () => `import { StreamAdmission } from "@server/api/live-stream/admission";
import { describe, expect, it } from "vitest";

describe("live stream admission", () => {
  it("enforces global and per-IP limits and releases idempotently", () => {
    const admission = new StreamAdmission(2, 1);
    const first = admission.acquire("192.0.2.1");
    expect(first.kind).toBe("accepted");
    expect(admission.acquire("192.0.2.1").kind).toBe("ip_limit");

    const second = admission.acquire("192.0.2.2");
    expect(second.kind).toBe("accepted");
    expect(admission.acquire("192.0.2.3").kind).toBe("global_limit");

    if (first.kind === "accepted") {
      first.lease.release();
      first.lease.release();
    }
    expect(admission.activeConnections).toBe(1);
    expect(admission.acquire("192.0.2.3").kind).toBe("accepted");
  });
});
`;

const liveStreamApiTest = () => `import {
  streamResponseHeaders,
  validateBrowserRequest,
} from "@server/api/live-stream";
import { describe, expect, it } from "vitest";

describe("live stream browser boundary", () => {
  it("refuses HEAD, which would take a connection slot it can never give back", () => {
    // Hono answers HEAD from the GET handler, and the body of a HEAD response
    // is never read — so the stream callback that releases the slot never runs.
    const head = validateBrowserRequest(
      new Request("http://127.0.0.1:3010/api/ticks", {
        method: "HEAD",
        headers: { accept: "text/event-stream" },
      }),
    );

    expect(head?.status).toBe(405);
  });

  it("rejects non-SSE and cross-site requests", async () => {
    const notSse = validateBrowserRequest(new Request("http://127.0.0.1:3010/api/ticks"));
    expect(notSse?.status).toBe(406);

    const crossSite = validateBrowserRequest(
      new Request("http://127.0.0.1:3010/api/ticks", {
        headers: { accept: "text/event-stream", "sec-fetch-site": "cross-site" },
      }),
    );
    expect(crossSite?.status).toBe(403);
    await expect(crossSite?.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("sets proxy-safe, private stream headers", () => {
    const headers = streamResponseHeaders();
    expect(headers.get("cache-control")).toBe("private, no-store, no-transform");
    expect(headers.get("x-accel-buffering")).toBe("no");
    expect(headers.get("vary")).toBe("Accept");
  });
});
`;

const liveMessageServiceTest =
  () => `import { getLiveMessage } from "@server/services/live-message";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));

vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetch: mocks.gatewayFetch,
}));

describe("gateway-backed progressive message", () => {
  beforeEach(() => mocks.gatewayFetch.mockReset());

  it("reads and validates the deferred gateway payload", async () => {
    mocks.gatewayFetch.mockResolvedValue(Response.json({ message: "gateway-ready" }));
    const signal = AbortSignal.timeout(1_000);

    await expect(getLiveMessage(signal)).resolves.toBe("gateway-ready");
    expect(mocks.gatewayFetch).toHaveBeenCalledWith("/live/message", { signal });
  });

  it("rejects an invalid payload instead of streaming untrusted data", async () => {
    mocks.gatewayFetch.mockResolvedValue(Response.json({ message: 42 }));
    await expect(getLiveMessage(AbortSignal.timeout(1_000))).rejects.toThrow(
      "Live message gateway returned an invalid payload",
    );
  });
});
`;

const authClientTest =
  () => `import { clientApiFetch } from "@originloom/shared/lib/client/api-fetch";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("BFF client refresh contract", () => {
  it("refreshes once after 401 and retries the original request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(clientApiFetch<{ ok: boolean }>("/api/private")).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "/api/private",
      "/api/internal/refresh",
      "/api/private",
    ]);
  });
});
`;

const sessionApiTest =
  () => `import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountSessionApi } from "@server/api/session";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("session BFF routes", () => {
  it.each([
    ["GET", "/api/session"],
    ["POST", "/api/internal/refresh"],
  ] as const)("mounts %s %s and never returns a public 404", async (method, path) => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("clientIp", "127.0.0.1");
      await next();
    });
    mountSessionApi(app);

    const response = await app.request(path, { method });
    expect(response.status).not.toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
`;

const botAnalyticsTest = () => `import type { BotVisit } from "@originloom/core/runtime";
import { BotAnalyticsQueue } from "@server/services/bot-analytics";
import { describe, expect, it, vi } from "vitest";

const visit: BotVisit = { pathname: "/", userAgent: "test-bot", trackingId: "tracking" };

describe("bot analytics queue", () => {
  it("is bounded and drains queued work", async () => {
    const sender = vi.fn(async () => {});
    const queue = new BotAnalyticsQueue(2, 10, 60_000, sender);

    expect(queue.enqueue(visit)).toBe("queued");
    expect(queue.enqueue(visit)).toBe("queued");
    expect(queue.enqueue(visit)).toBe("queue_full");
    await expect(queue.drain(1_000)).resolves.toBe(true);
    expect(sender).toHaveBeenCalledOnce();
    expect(queue.enqueue(visit)).toBe("closed");
  });
});
`;

const cacheKeyCodecTest = () => `import { describe, expect, it } from "vitest";

import {
  decodeCacheKeyFromApi,
  encodeCacheKeyForApi,
  formatCacheKey,
  parseCacheKey,
} from "~/lib/cache-keys";

describe("operations cache key codec", () => {
  it("round-trips separator and percent characters through purge transport", () => {
    const parts = ["catalog", "page=2", "value%with\\0separator"];
    const key = formatCacheKey(parts);
    expect(parseCacheKey(key)).toEqual(parts);
    expect(decodeCacheKeyFromApi(encodeCacheKeyForApi(key))).toBe(key);
  });
});
`;

const itemsService =
  () => `import { gatewayFetch, releaseGatewayResponse, requireGatewayOk } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedArray, isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

export type ItemSeo = { title: string; description: string };
export type Item = { slug: string; name: string; blurb: string; seo: ItemSeo };
export type ItemPage = { items: Item[]; total: number };

const INVALID = "Items gateway returned an invalid payload";

/**
 * Server-only data orchestration. Loaders call these; nothing here runs in the
 * browser, so this is where upstream calls, validation and error mapping live.
 */
export async function listItems(
  page: number,
  perPage: number,
  signal?: AbortSignal,
): Promise<ItemPage> {
  const response = await gatewayFetch(\`/items?page=\${page}&perPage=\${perPage}\`,
    signal ? { signal } : {},
  );
  await requireGatewayOk(response, "Items gateway returned");

  // Bounded read against this endpoint's contract, then a runtime guard: gateway
  // JSON is untrusted input, and a TypeScript type is not a check.
  const payload = await readGatewayJson(response, GatewayContracts.items, INVALID);
  return requireGatewayPayload(GatewayContracts.items, payload, isItemPage, INVALID);
}

export async function getItem(slug: string, signal: AbortSignal): Promise<Item | null> {
  const response = await gatewayFetch(\`/items/\${encodeURIComponent(slug)}\`, { signal });
  // A missing item is data, not a failure — the route turns it into notFound().
  if (response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  await requireGatewayOk(response, "Items gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.items, INVALID);
  return requireGatewayPayload(GatewayContracts.items, payload, isItem, INVALID);
}

function isItem(value: unknown): value is Item {
  return (
    isRecord(value) &&
    isBoundedString(value.slug, 100) &&
    isBoundedString(value.name, 200) &&
    isBoundedString(value.blurb, 1_000) &&
    isRecord(value.seo) &&
    isBoundedString(value.seo.title, 200) &&
    isBoundedString(value.seo.description, 500)
  );
}

export function isItemPage(value: unknown): value is ItemPage {
  return (
    isRecord(value) &&
    isBoundedArray(value.items, 100, isItem) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total)
  );
}
`;

const featuredItemsService = () => `import * as cache from "@originloom/core/cache";
import { logger } from "@originloom/core/logger";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";
import { productConfig } from "@server/product/config";

import { isItemPage, type ItemPage, listItems } from "./items";

type FeaturedItemsSnapshot = ItemPage & { fetchedAt: string };
export type FeaturedItemsCacheStatus = "fresh" | "miss" | "stale";
export type FeaturedItemsResult = FeaturedItemsSnapshot & {
  cacheStatus: FeaturedItemsCacheStatus;
};

const FEATURED_ITEMS_CACHE_KEY = "items:featured:v1";
const FEATURED_ITEMS_CACHE_POLICY = {
  kind: "shared" as const,
  ttl: productConfig.featuredItemsCacheTtl,
  swr: productConfig.featuredItemsCacheSwr,
  key: [FEATURED_ITEMS_CACHE_KEY],
};
let refreshInFlight: Promise<FeaturedItemsSnapshot> | undefined;

/**
 * Demonstrates endpoint-data caching independently from document caching.
 * The caller may render uncached HTML while this validated public snapshot is
 * shared by every request. User identity and authorization never enter the key.
 */
export async function getFeaturedItems(request: Request): Promise<FeaturedItemsResult> {
  const key = cache.cacheKey(FEATURED_ITEMS_CACHE_POLICY);
  if (!key) throw new Error("Featured items cache policy must be shared");

  const hit = await cache.read(key);
  if (hit) {
    const cached = parseSnapshot(hit.body);
    if (cached) {
      if (hit.state === "stale") scheduleRefresh();
      return { ...cached, cacheStatus: hit.state };
    }
    try {
      await cache.deleteKey(key);
    } catch (error) {
      logger.warn("invalid featured-items cache entry could not be deleted", {
        error: errorMessage(error),
      });
    }
  }

  const snapshot = await waitForRequest(refresh(key), request.signal);
  return { ...snapshot, cacheStatus: "miss" };
}

function refresh(key = cache.cacheKey(FEATURED_ITEMS_CACHE_POLICY)): Promise<FeaturedItemsSnapshot> {
  if (refreshInFlight) return refreshInFlight;
  if (!key) return Promise.reject(new Error("Featured items cache policy must be shared"));

  const pending = listItems(1, productConfig.catalogPageSize)
    .then(async (page) => {
      const snapshot = { ...page, fetchedAt: new Date().toISOString() };
      await cache.write(key, JSON.stringify(snapshot), FEATURED_ITEMS_CACHE_POLICY);
      return snapshot;
    })
    .finally(() => {
      if (refreshInFlight === pending) refreshInFlight = undefined;
    });
  refreshInFlight = pending;
  return pending;
}

function scheduleRefresh(): void {
  void refresh().catch((error: unknown) => {
    logger.warn("stale featured-items refresh failed", { error: errorMessage(error) });
  });
}

function parseSnapshot(body: string): FeaturedItemsSnapshot | null {
  try {
    const value: unknown = JSON.parse(body);
    return isFeaturedItemsSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

function isFeaturedItemsSnapshot(value: unknown): value is FeaturedItemsSnapshot {
  return isRecord(value) && isBoundedString(value.fetchedAt, 100) && isItemPage(value);
}

function waitForRequest<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Request aborted"));
    const settle = <TValue>(fn: (value: TValue) => void, value: TValue) => {
      signal.removeEventListener("abort", abort);
      fn(value);
    };
    signal.addEventListener("abort", abort, { once: true });
    void work.then(
      (value) => settle(resolve, value),
      (error: unknown) => settle(reject, error),
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
`;

const liveMessageService =
  () => `import { gatewayFetch, requireGatewayOk } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

type LiveMessage = { message: string };

const INVALID = "Live message gateway returned an invalid payload";

/**
 * Starts real upstream work without hiding it behind a local timer. The route
 * deliberately keeps this Promise pending in its data so React can stream the
 * shell while the gateway response is still in flight.
 */
export async function getLiveMessage(signal: AbortSignal): Promise<string> {
  const response = await gatewayFetch("/live/message", { signal });
  await requireGatewayOk(response, "Live message gateway returned");
  const payload = await readGatewayJson(response, GatewayContracts.liveMessage, INVALID);
  return requireGatewayPayload(
    GatewayContracts.liveMessage,
    payload,
    isLiveMessage,
    INVALID,
  ).message;
}

function isLiveMessage(value: unknown): value is LiveMessage {
  return isRecord(value) && isBoundedString(value.message, 200);
}
`;

const apiIndex = () => `import { mountClientErrorApi } from "@originloom/core/api/client-errors";
import { mountClientMetricApi } from "@originloom/core/api/client-metrics";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountEnquiryApi } from "@server/api/enquiries";
import { mountPublicItemsApi } from "@server/api/items";
import { mountLiveStreamApi } from "@server/api/live-stream";
import { mountSessionApi } from "@server/api/session";
import type { Hono } from "hono";

/**
 * Product BFF / API routes. Mounted before SSR dispatch, so anything under /api/*
 * is handled here and never reaches a page route.
 */
export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  // The island runtime reports client-side failures here. Without it every
  // browser error turns into a 404 in the console instead of a server log.
  mountClientErrorApi(app);
  mountClientMetricApi(app);

  mountPublicItemsApi(app);

  // The contact form posts here. A public write, so it is same-origin checked
  // and rate limited — see docs/mutations.md.
  mountEnquiryApi(app);

  // "Who am I", answered from HttpOnly cookies. The account island calls it.
  mountSessionApi(app);
  mountLiveStreamApi(app);
}
`;

const liveStreamAdmission = () => `export type StreamLease = { release: () => void };
export type AdmissionResult =
  | { kind: "accepted"; lease: StreamLease }
  | { kind: "global_limit" | "ip_limit" };

/** Active-connection accounting. Release is idempotent so every exit path is safe. */
export class StreamAdmission {
  private active = 0;
  private readonly byIp = new Map<string, number>();

  constructor(
    private readonly globalLimit: number,
    private readonly perIpLimit: number,
  ) {}

  acquire(clientIp: string): AdmissionResult {
    if (this.active >= this.globalLimit) return { kind: "global_limit" };
    const current = this.byIp.get(clientIp) ?? 0;
    if (current >= this.perIpLimit) return { kind: "ip_limit" };

    this.active++;
    this.byIp.set(clientIp, current + 1);
    let released = false;
    return {
      kind: "accepted",
      lease: {
        release: () => {
          if (released) return;
          released = true;
          this.active--;
          const count = this.byIp.get(clientIp) ?? 1;
          if (count <= 1) this.byIp.delete(clientIp);
          else this.byIp.set(clientIp, count - 1);
        },
      },
    };
  }

  get activeConnections(): number {
    return this.active;
  }
}
`;

const liveStreamApi = () => `import { config } from "@originloom/core/config";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import {
  observeLiveStreamConnection,
  setLiveStreamActiveConnections,
} from "@server/metrics/live-stream";
import { productConfig } from "@server/product/config";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { StreamAdmission } from "./admission";

const admission = new StreamAdmission(
  productConfig.liveStreamMaxConnections,
  productConfig.liveStreamMaxConnectionsPerIp,
);
const shutdownController = new AbortController();
/** A real stream starts in milliseconds; past this it never will. */
const STREAM_START_TIMEOUT_MS = 5_000;

export function mountLiveStreamApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/ticks", (c) => {
    c.set("requestRoute", "/api/ticks");
    return handleLiveStream(c);
  });
}

function handleLiveStream(c: Context<{ Variables: AppVariables }>): Response {
  const request = contextRequest(c);
  const invalid = validateBrowserRequest(request);
  if (invalid) {
    observeLiveStreamConnection("invalid_request");
    return invalid;
  }

  const accepted = admission.acquire(c.get("clientIp") ?? "unresolved");
  if (accepted.kind !== "accepted") {
    observeLiveStreamConnection(accepted.kind);
    return errorResponse("Canlı bağlantı limiti aşıldı", 429, { "retry-after": "15" });
  }
  observeLiveStreamConnection("accepted");
  setLiveStreamActiveConnections(admission.activeConnections);

  /**
   * The slot is taken here so the limit can be answered with 429, but it is
   * handed back inside the stream body — and a body that is never read never
   * runs. Anything that takes a response without consuming it would keep its
   * slot for the lifetime of the process, and \`LIVE_STREAM_MAX_CONNECTIONS_PER_IP\`
   * of those would lock an address out of the stream for good.
   */
  let started = false;
  const startTimeout = setTimeout(() => {
    if (started) return;
    accepted.lease.release();
    observeLiveStreamConnection("never_started");
    setLiveStreamActiveConnections(admission.activeConnections);
  }, STREAM_START_TIMEOUT_MS);
  startTimeout.unref?.();

  const response = streamSSE(c, async (stream) => {
    started = true;
    clearTimeout(startTimeout);
    const expiresAt = Date.now() + productConfig.liveStreamMaxDurationMs;
    const close = () => stream.close();
    const aborted = new Promise<void>((resolve) => stream.onAbort(resolve));
    request.signal.addEventListener("abort", close, { once: true });
    shutdownController.signal.addEventListener("abort", close, { once: true });
    try {
      await stream.writeSSE({ event: "ready", retry: 2_000, data: "connected" });
      while (
        !stream.aborted &&
        !request.signal.aborted &&
        !shutdownController.signal.aborted &&
        Date.now() < expiresAt
      ) {
        await stream.writeSSE({ event: "tick", data: new Date().toISOString() });
        await Promise.race([
          wait(Math.min(productConfig.liveStreamHeartbeatMs, expiresAt - Date.now())),
          aborted,
        ]);
      }
      if (!stream.aborted && !request.signal.aborted && !shutdownController.signal.aborted) {
        await stream.writeSSE({ event: "rotate", data: "reconnect" });
      }
    } finally {
      request.signal.removeEventListener("abort", close);
      shutdownController.signal.removeEventListener("abort", close);
      accepted.lease.release();
      observeLiveStreamConnection("closed");
      setLiveStreamActiveConnections(admission.activeConnections);
    }
  });

  streamResponseHeaders(response.headers);
  return response;
}

export function stopLiveStreams(): void {
  shutdownController.abort();
}

export function validateBrowserRequest(request: Request): Response | null {
  // Hono answers HEAD from the GET handler, and an event stream has no
  // headers-only representation: there is nothing to describe without opening
  // the stream itself.
  if (request.method === "HEAD") {
    return errorResponse("HEAD desteklenmiyor", 405, { allow: "GET" });
  }
  if (!request.headers.get("accept")?.toLowerCase().includes("text/event-stream")) {
    return errorResponse("SSE Accept header zorunludur", 406);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return errorResponse("Cross-site stream reddedildi", 403);
  }
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    return new URL(origin).origin === new URL(config.siteUrl).origin
      ? null
      : errorResponse("Cross-origin stream reddedildi", 403);
  } catch {
    return errorResponse("Geçersiz Origin", 403);
  }
}

export function streamResponseHeaders(headers = new Headers()): Headers {
  headers.set("cache-control", "private, no-store, no-transform");
  headers.set("x-accel-buffering", "no");
  headers.set("vary", "Accept");
  return headers;
}

function errorResponse(message: string, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(1, ms));
    timer.unref?.();
  });
}
`;

const itemDetailRoute = () => `import { defineRoute, notFound } from "@originloom/react/lib/types";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/shared/lib/metadata/jsonld";
import { getItem, type Item } from "@server/services/items";

import { ItemDetailPage } from "~/features/items/item-detail-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { item: Item };

export default defineRoute<Data>({
  path: "/items/:slug",
  // Reject unbounded / garbage slugs before any cache lookup or render.
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  // The slug is part of the cache key (see cache-keys.ts), so each item caches on its own.
  cache: pageCache(PageCacheId.itemDetail),
  loader: async (ctx) => {
    const item = await getItem(ctx.params.slug ?? "", ctx.request.signal);
    // Terminal result, not a thrown error — an unknown slug is a 404, never cached.
    return item ? { data: { item } } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const baseUrl = ctx.siteUrl ?? ctx.url.origin;
    const canonical = baseUrl + "/items/" + data.item.slug;
    return {
      title: data.item.seo.title,
      description: data.item.seo.description,
      canonical,
      jsonLd: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana sayfa", url: "/" },
            { name: "Katalog", url: "/catalog" },
            { name: data.item.name, url: canonical },
          ],
          baseUrl,
        ),
      ]),
    };
  },
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "item-detail"),
  Component: ItemDetailPage,
});
`;

const itemDetailPage = () => `import { Link } from "@originloom/react/lib/link";
import type { Item } from "@server/services/items";

export function ItemDetailPage({ data }: { data: { item: Item } }) {
  return (
    <div className="space-y-4">
      <Link className="text-sm text-slate-500 hover:underline" href="/catalog">
        ← Kataloğa dön
      </Link>
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

import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

/**
 * Personal page: the document is never cached (registry strategy "never"), and the
 * per-user content comes from a defer island that fetches client-side. This is the
 * cache-safe personalization pattern — see the caching and islands skills.
 */
export default defineRoute({
  path: "/account",
  cache: pageCache(PageCacheId.account),
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
        <p className="text-slate-500">Kişisel bilgiler yükleniyor…</p>
      </Island>
    </div>
  ),
});
`;

const accountPanelIsland =
  () => `import { AppQueryProvider } from "@originloom/react/lib/query/provider";
import { ClientApiError } from "@originloom/shared/lib/client/api-fetch";

import { useSessionQuery } from "~/lib/query/hooks/use-session";

/**
 * Defer island: the server renders only the fallback, and this mounts in the
 * browser and asks /api/session who the user is. That is the cache-safe
 * personalization pattern — the document stays shared and cacheable while the
 * per-user part is fetched, so no one is ever served someone else's name.
 */
export default function AccountPanel() {
  return (
    <AppQueryProvider>
      <AccountPanelContent />
    </AppQueryProvider>
  );
}

function AccountPanelContent() {
  const session = useSessionQuery();
  const signedOut = session.error instanceof ClientApiError && session.error.status === 401;

  return (
    <div className="rounded-md border border-slate-200 p-4">
      {session.isPending ? <p className="text-slate-500">Oturum kontrol ediliyor…</p> : null}
      {session.data ? (
        <>
          <p className="font-medium text-slate-900">
            <span className="mr-2 inline-block rounded-full bg-slate-900 px-2 py-1 text-xs text-white">
              {session.data.profile.initials}
            </span>
            Merhaba {session.data.profile.displayName}
          </p>
          <p className="text-sm text-slate-600">
            Bu blok TanStack Query ile yalnızca tarayıcıda yüklendi ve paylaşılan HTML cache'e girmez.
          </p>
        </>
      ) : null}
      {signedOut ? (
        <p className="text-sm text-slate-600">Giriş yapılmamış.</p>
      ) : null}
      {/* "Bilinmiyor" is not "çıkış yapıldı": an upstream hiccup must not sign anyone out. */}
      {session.isError && !signedOut ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>Oturum bilgisi şu an alınamıyor.</p>
          <button
            type="button"
            onClick={() => void session.refetch()}
            disabled={session.isFetching}
            className="font-medium text-slate-900 hover:underline disabled:opacity-50"
          >
            {session.isFetching ? "Yeniden deneniyor…" : "Tekrar dene"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
`;

const queryKeys = () => `export const queryKeys = {
  session: {
    current: () => ["session", "current"] as const,
  },
} as const;
`;

const sessionQueryHook =
  () => `import { ClientApiError, clientApiFetch } from "@originloom/shared/lib/client/api-fetch";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "~/lib/query/keys";

export interface SessionResponse {
  profile: { displayName: string; initials: string };
}

export function fetchSession(signal: AbortSignal): Promise<SessionResponse> {
  // Cookies are HttpOnly; clientApiFetch includes them without exposing tokens to JavaScript.
  return clientApiFetch<SessionResponse>("/api/session", { signal });
}

export function useSessionQuery() {
  return useQuery({
    queryKey: queryKeys.session.current(),
    queryFn: ({ signal }) => fetchSession(signal),
    retry: (failureCount, error) => {
      if (error instanceof ClientApiError && error.status === 401) return false;
      return failureCount < 1;
    },
  });
}
`;

const dataCacheRoute = () => `import { defineRoute } from "@originloom/react/lib/types";
import { neverCache } from "@originloom/shared/lib/cache-policy";
import { type FeaturedItemsResult, getFeaturedItems } from "@server/services/featured-items";

import { DataCachePage } from "~/features/data-cache/data-cache-page";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { apiData: FeaturedItemsResult; pageRenderedAt: string };

export default defineRoute<Data>({
  path: "/data-cache",
  // Deliberately render the document on every request. Only the validated
  // upstream payload in getFeaturedItems() is shared between requests.
  cache: neverCache,
  loader: async (ctx) => ({
    data: {
      apiData: await getFeaturedItems(ctx.request),
      pageRenderedAt: new Date().toISOString(),
    },
  }),
  generateMetadata: () => ({
    title: "API data cache örneği",
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "data-cache"),
  Component: DataCachePage,
});
`;

const dataCachePage = () => `import { Link } from "@originloom/react/lib/link";
import type { FeaturedItemsResult } from "@server/services/featured-items";

type Props = { data: { apiData: FeaturedItemsResult; pageRenderedAt: string } };

const CACHE_STATUS_LABEL = {
  fresh: "FRESH — veri cache'ten geldi",
  miss: "MISS — gateway çağrıldı ve cache dolduruldu",
  stale: "STALE — eski veri sunuldu, arkada tek refresh başladı",
} as const;

export function DataCachePage({ data }: Props) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">API data cache</h1>
        <p className="max-w-3xl text-slate-600">
          Bu sayfanın HTML'i cache'lenmez. SSR her istekte yeniden çalışır; yalnız doğrulanmış
          gateway payload'ı sunucu tarafındaki read-through cache'te paylaşılır.
        </p>
      </header>

      <dl className="grid gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium text-slate-900">HTML render zamanı</dt>
          <dd data-testid="page-rendered-at" className="mt-1 font-mono text-slate-600">
            {data.pageRenderedAt}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-900">Gateway veri zamanı</dt>
          <dd data-testid="api-fetched-at" className="mt-1 font-mono text-slate-600">
            {data.apiData.fetchedAt}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-slate-900">Data cache sonucu</dt>
          <dd data-testid="api-cache-status" className="mt-1 text-slate-600">
            {CACHE_STATUS_LABEL[data.apiData.cacheStatus]}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="featured-items-heading" className="space-y-3">
        <h2 id="featured-items-heading" className="text-xl font-semibold text-slate-900">
          Cache'lenen API verisi
        </h2>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-4">
          {data.apiData.items.map((item) => (
            <li key={item.slug} className="py-3">
              <Link className="font-medium text-slate-800 hover:underline" href={"/items/" + item.slug}>
                {item.name}
              </Link>
              <p className="text-sm text-slate-500">{item.blurb}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm leading-6 text-slate-500">
        Sayfayı yenilediğinizde HTML render zamanı değişir. Veri zamanı TTL boyunca aynı kalır;
        response <code>x-cache: BYPASS</code> taşırken API verisi FRESH veya STALE olabilir.
      </p>
    </div>
  );
}
`;

const catalogRoute = () => `import { defineRoute } from "@originloom/react/lib/types";
import { compactJsonLd, itemListJsonLd } from "@originloom/shared/lib/metadata/jsonld";
import { observeCatalogView } from "@server/metrics/catalog";
import { productConfig } from "@server/product/config";
import { type Item, listItems } from "@server/services/items";

import { CatalogPage } from "~/features/catalog/catalog-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { pageParam } from "~/lib/pagination";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { items: Item[]; page: number; totalPages: number };

export default defineRoute<Data>({
  path: "/catalog",
  // Only the normalized ?page value changes the HTML, so only it enters the key.
  cache: pageCache(PageCacheId.catalog),
  loader: async (ctx) => {
    const page = pageParam(ctx.url);
    const perPage = productConfig.catalogPageSize;
    const { items, total } = await listItems(page, perPage, ctx.request.signal);
    observeCatalogView(page);
    return { data: { items, page, totalPages: Math.max(1, Math.ceil(total / perPage)) } };
  },
  generateMetadata: (data, ctx) => {
    const baseUrl = ctx.siteUrl ?? ctx.url.origin;
    const canonical = data.page === 1 ? baseUrl + "/catalog" : baseUrl + "/catalog?page=" + data.page;
    return {
      title: data.page === 1 ? "Katalog" : \`Katalog — Sayfa \${data.page}\`,
      canonical,
      jsonLd: compactJsonLd([
        itemListJsonLd(
          "Katalog",
          data.items.map((item) => ({ name: item.name, url: "/items/" + item.slug })),
          baseUrl,
        ),
      ]),
    };
  },
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "catalog"),
  Component: CatalogPage,
});
`;

const catalogPage = () => `import { Link } from "@originloom/react/lib/link";
import type { Item } from "@server/services/items";

type Props = { data: { items: Item[]; page: number; totalPages: number } };

export function CatalogPage({ data }: Props) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Katalog</h1>
      <ul className="divide-y divide-slate-100">
        {data.items.map((item) => (
          <li key={item.slug} className="py-3">
            <Link className="font-medium text-slate-800 hover:underline" href={"/items/" + item.slug}>
              {item.name}
            </Link>
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
          <span className="text-slate-500">← Önceki</span>
        )}
        <span aria-current="page" className="text-slate-500">
          Sayfa {data.page} / {data.totalPages}
        </span>
        {data.page < data.totalPages ? (
          <a className="text-slate-700 hover:underline" href={"?page=" + (data.page + 1)}>
            Sonraki →
          </a>
        ) : (
          <span className="text-slate-500">Sonraki →</span>
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
import { getLiveMessage } from "@server/services/live-message";

import { LivePage } from "~/features/live/live-page";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { slowMessage: Promise<string> };

export default defineRoute<Data>({
  path: "/live",
  // Progressive HTML: the shell streams first, Suspense boundaries fill in later.
  streaming: true,
  cache: neverCache,
  loader: async (ctx) => ({
    data: {
      // Do not await this non-critical upstream value. The shell streams while
      // the gateway is in flight; Suspense fills the boundary when it resolves.
      slowMessage: getLiveMessage(ctx.request.signal),
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

/**
 * Defer island: subscribes to the /api/ticks SSE stream in the browser.
 *
 * The stream is opened and closed around the page's visibility in the session
 * history, not just around the component's lifetime. An open connection makes
 * the page ineligible for the back/forward cache, which turns the browser's
 * instant restore into a full reload — on every page this island appears.
 */
export default function LiveTicks() {
  const [tick, setTick] = useState("bağlanıyor…");
  useEffect(() => {
    let source: EventSource | null = null;

    const open = () => {
      if (source) return;
      const stream = new EventSource("/api/ticks");
      source = stream;
      stream.addEventListener("tick", (event: MessageEvent<string>) => setTick(event.data));
      stream.addEventListener("rotate", () => {
        setTick("bağlantı yenileniyor…");
        close();
        open();
      });
      // EventSource reconnects automatically after transient failures.
      stream.onerror = () => setTick("yeniden bağlanıyor…");
    };

    const close = () => {
      source?.close();
      source = null;
    };

    open();
    // pagehide fires for a bfcache entry where unload does not; pageshow tells us
    // whether we came back from that cache and have to reopen.
    const onHide = () => close();
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) open();
    };
    addEventListener("pagehide", onHide);
    addEventListener("pageshow", onShow);

    return () => {
      removeEventListener("pagehide", onHide);
      removeEventListener("pageshow", onShow);
      close();
    };
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

/** Canonical cache representation: missing, invalid and page=1 are identical. */
export function normalizePageParam(value: string | null): string {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 ? String(page) : "1";
}
`;

const serverShellData = () => `import type { Ctx } from "@originloom/react/lib/types";
import { getMenu } from "@server/services/menu";

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
  const menu = await getMenu(ctx.request);
  return { ...buildLayoutClientProps(ctx, opts), menu };
}
`;

const menuService =
  () => `import { gatewayFetch, requireGatewayOk } from "@originloom/core/adapters/gateway";
import * as cache from "@originloom/core/cache";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { logger } from "@originloom/core/logger";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import { memoizeRequestValue } from "@originloom/core/observability";
import { isBoundedArray, isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";
import { productConfig } from "@server/product/config";

import type { MenuItem } from "~/lib/menu";

import { GatewayContracts } from "./gateway-contracts";

const FALLBACK_MENU: MenuItem[] = [
  { label: "Ana sayfa", href: "/" },
  { label: "Katalog", href: "/catalog" },
];
const MENU_CACHE_KEY = "menu:public:v1";
const MENU_CACHE_POLICY = {
  kind: "shared" as const,
  ttl: productConfig.menuCacheTtl,
  swr: productConfig.menuCacheSwr,
  key: [MENU_CACHE_KEY],
};
let refreshInFlight: Promise<MenuItem[]> | undefined;
let parsedSnapshot: { body: string; menu: MenuItem[] } | undefined;

/**
 * Public chrome data with read-through cache. Fresh entries return immediately;
 * stale entries return immediately and trigger one process-local refresh.
 */
export function getMenu(request: Request): Promise<MenuItem[]> {
  return memoizeRequestValue("gateway:menu:public", () => loadMenu(request));
}

async function loadMenu(request: Request): Promise<MenuItem[]> {
  try {
    const key = cache.cacheKey(MENU_CACHE_POLICY);
    if (!key) throw new Error("Menu cache policy must be shared");

    const hit = await cache.read(key);
    if (hit) {
      if (parsedSnapshot?.body === hit.body) {
        if (hit.state === "stale") scheduleRefresh();
        return parsedSnapshot.menu;
      }
      const cached = parseCachedMenu(hit.body);
      if (cached) {
        const menu = freezeMenu(cached);
        parsedSnapshot = { body: hit.body, menu };
        if (hit.state === "stale") scheduleRefresh();
        return menu;
      }
      // Old/corrupt values never poison future reads. A failed delete is harmless:
      // the successful write below replaces the same key.
      try {
        await cache.deleteKey(key);
      } catch (error) {
        logger.warn("invalid menu cache entry could not be deleted", { error: errorMessage(error) });
      }
    }

    return await waitForRequest(refreshMenu(key), request.signal);
  } catch (error) {
    if (isRequestDeadlineError(error) || request.signal.aborted) throw error;
    logger.warn("menu degraded to local fallback", { error: errorMessage(error) });
    return FALLBACK_MENU;
  }
}

/** Single-flight refresh bounds cold-miss and stale-refresh pressure on the gateway. */
function refreshMenu(key = cache.cacheKey(MENU_CACHE_POLICY)): Promise<MenuItem[]> {
  if (refreshInFlight) return refreshInFlight;
  if (!key) return Promise.reject(new Error("Menu cache policy must be shared"));

  const pending = fetchMenuFromGateway()
    .then(async (menu) => {
      const immutable = freezeMenu(menu);
      const body = JSON.stringify(immutable);
      await cache.write(key, body, MENU_CACHE_POLICY);
      parsedSnapshot = { body, menu: immutable };
      return immutable;
    })
    .finally(() => {
      if (refreshInFlight === pending) refreshInFlight = undefined;
    });
  refreshInFlight = pending;
  return pending;
}

function scheduleRefresh(): void {
  void refreshMenu().catch((error: unknown) => {
    // The stale value remains usable until staleUntil; the next stale request may retry.
    logger.warn("stale menu refresh failed", { error: errorMessage(error) });
  });
}

async function fetchMenuFromGateway(): Promise<MenuItem[]> {
  // Menu is public/cacheable, so never forward a caller's Authorization header.
  const response = await gatewayFetch("/menu");
  await requireGatewayOk(response, "Menu gateway returned");
  const payload = await readGatewayJson(response, GatewayContracts.menu, "Invalid menu payload");
  return requireGatewayPayload(GatewayContracts.menu, payload, isMenu, "Invalid menu payload");
}

function parseCachedMenu(body: string): MenuItem[] | null {
  try {
    const value: unknown = JSON.parse(body);
    return isMenu(value) ? value : null;
  } catch {
    return null;
  }
}

/** Bounded process snapshot: cache hits reuse validated objects instead of JSON parsing again. */
function freezeMenu(menu: MenuItem[]): MenuItem[] {
  for (const item of menu) Object.freeze(item);
  return Object.freeze(menu) as MenuItem[];
}

function waitForRequest<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Request aborted"));
    const settle = <TValue>(fn: (value: TValue) => void, value: TValue) => {
      signal.removeEventListener("abort", abort);
      fn(value);
    };
    signal.addEventListener("abort", abort, { once: true });
    void work.then(
      (value) => settle(resolve, value),
      (error: unknown) => settle(reject, error),
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMenu(value: unknown): value is MenuItem[] {
  return isBoundedArray(
    value,
    20,
    (item): item is MenuItem =>
      isRecord(item) &&
      isBoundedString(item.label, 80) &&
      isBoundedString(item.href, 256) &&
      item.href.startsWith("/") &&
      !item.href.startsWith("//"),
  );
}
`;

const menuLib = () => `export type MenuItem = { label: string; href: string };
`;

const botAnalyticsService =
  () => `import { gatewayFetch, releaseGatewayResponse, requireGatewayOk } from "@originloom/core/adapters/gateway";
import { logger } from "@originloom/core/logger";
import type { BotVisit } from "@originloom/core/runtime";
import { productConfig } from "@server/product/config";

type Sender = (events: BotVisit[], signal: AbortSignal) => Promise<void>;

/** Bounded, non-blocking queue: bot traffic can never create unbounded promises. */
export class BotAnalyticsQueue {
  private readonly queue: BotVisit[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private sending = false;
  private accepting = true;

  constructor(
    private readonly capacity: number,
    private readonly batchSize: number,
    private readonly flushMs: number,
    private readonly sender: Sender,
  ) {}

  enqueue(event: BotVisit): "queued" | "queue_full" | "closed" {
    if (!this.accepting) return "closed";
    if (this.queue.length >= this.capacity) return "queue_full";
    this.queue.push({
      pathname: event.pathname.slice(0, 2_048),
      userAgent: event.userAgent.slice(0, 512),
      trackingId: event.trackingId.slice(0, 128),
    });
    if (this.queue.length >= this.batchSize) void this.flush();
    else this.schedule();
    return "queued";
  }

  async drain(timeoutMs: number): Promise<boolean> {
    this.accepting = false;
    this.clearTimer();
    const work = this.flushAll().then(() => true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<boolean>((resolve) => {
      const deadlineTimer = setTimeout(() => {
        this.queue.splice(0);
        this.controller?.abort();
        resolve(false);
      }, timeoutMs);
      timer = deadlineTimer;
      deadlineTimer.unref?.();
    });
    const drained = await Promise.race([work, deadline]);
    if (timer) clearTimeout(timer);
    return drained;
  }

  snapshot(): { queued: number; sending: boolean; accepting: boolean } {
    return { queued: this.queue.length, sending: this.sending, accepting: this.accepting };
  }

  private schedule(): void {
    if (this.timer || this.sending || this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.flushMs);
    this.timer.unref?.();
  }

  private async flushAll(): Promise<void> {
    while (this.queue.length > 0 || this.sending) {
      if (!this.sending) await this.flush();
      else await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    this.clearTimer();
    const events = this.queue.splice(0, this.batchSize);
    this.sending = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.sender(events, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.warn("bot analytics batch failed", {
          eventCount: events.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.controller = undefined;
      this.sending = false;
      if (this.accepting) this.schedule();
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

const queue = new BotAnalyticsQueue(
  productConfig.botAnalyticsQueueCapacity,
  productConfig.botAnalyticsBatchSize,
  productConfig.botAnalyticsFlushMs,
  sendBatch,
);

export function storeBotVisit(visit: BotVisit): void {
  queue.enqueue(visit);
}

export function drainBotAnalytics(): Promise<boolean> {
  return queue.drain(productConfig.botAnalyticsDrainTimeoutMs);
}

async function sendBatch(events: BotVisit[], signal: AbortSignal): Promise<void> {
  const response = await gatewayFetch("/analytics/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
    signal,
  });
  await requireGatewayOk(response, "Bot analytics gateway returned");
  await releaseGatewayResponse(response);
}
`;

const productRuntime =
  () => `import { installRuntime, type OriginRuntime } from "@originloom/core/runtime";
import { configureSiteMetadata } from "@originloom/shared/lib/metadata/site-config";
import { catalogMetricLines } from "@server/metrics/catalog";
import { liveStreamMetricLines } from "@server/metrics/live-stream";
import { storeBotVisit } from "@server/services/bot-analytics";
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
  onBotVisit: storeBotVisit,
  // This app's own metrics, appended to the platform's /metrics output.
  metricSources: [catalogMetricLines, liveStreamMetricLines],
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
import { reportWebVital } from "@originloom/shared/lib/client/performance-telemetry";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";

installReloadButtons();

// Quality telemetry must not compete with first paint or island hydration.
// The dynamic import keeps web-vitals out of the initial route chunk.
const observeWebVitals = () => {
  void import("web-vitals")
    .then(({ onCLS, onINP, onLCP }) => {
      for (const observe of [onCLS, onINP, onLCP]) {
        observe(({ name, value, rating }) => reportWebVital({ name, value, rating }));
      }
    })
    .catch((error) => reportClientError("performance-telemetry", error));
};
const scheduleWebVitals = () => {
  const requestIdle = (
    window as unknown as { requestIdleCallback?: (callback: () => void) => number }
  ).requestIdleCallback;
  if (requestIdle) requestIdle.call(window, observeWebVitals);
  else setTimeout(observeWebVitals, 0);
};
if (document.readyState === "complete") scheduleWebVitals();
else window.addEventListener("load", scheduleWebVitals, { once: true });

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
import { Link } from "@originloom/react/lib/link";
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
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
        >
          Tıklandı: {0}
        </button>
      </Island>

      <section className="space-y-2 border-t border-slate-100 pt-6">
        <h2 className="font-semibold text-slate-800">Örnek route'lar</h2>
        <p className="text-sm text-slate-500">Her biri farklı bir platform yeteneğini gösterir:</p>
        <ul className="space-y-1 text-slate-700">
          <li>
            <Link className="hover:underline" href="/catalog">
              /catalog
            </Link>{" "}
            — sayfalı liste (query param cache key'de)
          </li>
          <li>
            <Link className="hover:underline" href="/items/alpha">
              /items/:slug
            </Link>{" "}
            — dinamik route, <code>validateParams</code> + <code>notFound()</code> + SEO
          </li>
          <li>
            <Link className="hover:underline" href="/old-catalog?source=home">
              /old-catalog
            </Link>{" "}
            — static <code>308</code> redirect; query korunur
          </li>
          <li>
            <Link className="hover:underline" href="/products/alpha?source=home">
              /products/:slug
            </Link>{" "}
            — URL değişmeden <code>/items/:slug</code> route'una rewrite
          </li>
          <li>
            <Link className="hover:underline" href="/legacy-catalog">
              /legacy-catalog
            </Link>{" "}
            — mock CMS redirect; <code>/removed-page</code> ise <code>410</code>
          </li>
          <li>
            <Link className="hover:underline" href="/account">
              /account
            </Link>{" "}
            — kişisel sayfa: <code>neverCache</code> + defer island
          </li>
          <li>
            <Link className="hover:underline" href="/data-cache">
              /data-cache
            </Link>{" "}
            — HTML her istekte render edilir, public gateway verisi read-through cache'ten gelir
          </li>
          <li>
            <Link className="hover:underline" href="/live">
              /live
            </Link>{" "}
            — sunucu streaming (Suspense) + SSE island
          </li>
          <li>
            <Link className="hover:underline" href="/media">
              /media
            </Link>{" "}
            — görsel pipeline: responsive vs dönüşümsüz teslim, CDN durumu
          </li>
          <li>
            <Link className="hover:underline" href="/showcase">
              /showcase
            </Link>{" "}
            — bağımsız cache'lenen fragment
          </li>
        </ul>
      </section>
    </div>
  );
}
`;

const rootLayout = (title) => `import { Link } from "@originloom/react/lib/link";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
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
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              {SITE_NAME}
            </Link>
            <div className="flex items-center gap-6">
              <nav aria-label="Ana menü">
                <ul className="flex gap-4 text-sm text-slate-600">
                  {shell.menu.map((item) => (
                    <li key={item.href}>
                      <Link className="hover:text-slate-950 hover:underline" href={item.href}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
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

import type { MenuItem } from "~/lib/menu";

/** Cache-safe props for the shell — no trackingId, no auth tokens. */
export type ShellData = {
  publicPath: string;
  pathname: string;
  theme?: string;
  minimalChrome?: boolean;
  deviceType: DeviceType;
  deviceShell: "desktop" | "mobile";
  menu: MenuItem[];
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
    menu: [],
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

const cacheKeys = () => `import type {
  CachePolicy,
  Ctx,
  RouteCacheResolver,
} from "@originloom/react/lib/types";
import {
  describeRouteCache,
  neverCache,
  sharedUnlessBypass,
} from "@originloom/shared/lib/cache-policy";
import {
  contentQueryCacheFragment,
  type ContentQueryConfig,
} from "@originloom/shared/lib/cache-query-params";
import { locale } from "@originloom/shared/lib/request";

import { normalizePageParam } from "~/lib/pagination";
import { layoutCacheFragment } from "~/lib/shell-data";

export {
  decodeCacheKeyFromApi,
  displayCacheKey,
  encodeCacheKeyForApi,
  formatCacheKey,
  parseCacheKey,
  toCacheKeyApiEntry,
} from "@originloom/core/cache/key-codec";

/**
 * HTML page cache identities. The purge API and the metrics route labels are
 * derived from this registry, so every cacheable page needs an entry here.
 */
export const PageCacheId = {
  home: "home",
  catalog: "catalog",
  itemDetail: "item-detail",
  account: "account",
  contact: "contact",
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
  contentQuery?: ContentQueryConfig;
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
    contentQuery: {
      include: ["page"],
      defaults: { page: "1" },
      normalize: { page: normalizePageParam },
    },
    // Only allowlisted, normalized content params enter the key. Tracking and
    // unknown params cannot fragment the shared HTML cache.
    buildKey: (ctx) => [
      "catalog",
      contentQueryCacheFragment(ctx, pageCacheRegistry[PageCacheId.catalog].contentQuery!),
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
  [PageCacheId.contact]: {
    id: PageCacheId.contact,
    description: "İletişim formu (yazma sonucu gösterir — cache'lenmez)",
    path: "/contact",
    // The page renders the outcome of a write; sharing that HTML would show one
    // visitor's result to the next.
    strategy: "never",
    buildKey: () => ["contact"],
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

/** Route resolver plus build-readable metadata; runtime policy remains authoritative. */
export function pageCache(id: PageCacheId): RouteCacheResolver {
  const entry = pageCacheRegistry[id];
  if (entry.strategy === "never") {
    return describeRouteCache(() => neverCache(), {
      mode: "none",
      label: entry.description,
    });
  }
  return describeRouteCache((ctx) => pageCachePolicy(id, ctx), {
    mode: "conditional",
    ttl: entry.ttl ?? DEFAULT_TTL,
    swr: entry.swr ?? DEFAULT_SWR,
    ...(entry.contentQuery?.include.length ? { vary: entry.contentQuery.include } : {}),
    label: entry.description,
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

const routingRules = (
  includeExamples = false,
  locales,
) => `import type { RedirectRule, RewriteRule } from "@originloom/shared/routing/types";${
  Array.isArray(locales) && locales.length > 1
    ? `

/**
 * Non-default locale prefixes are stripped before the route table is matched, so
 * routes stay written once: /en/catalog matches the /catalog route while the
 * browser-visible path — the one canonical URLs and cache keys use — keeps its
 * prefix. The default language owns the bare path and needs no rule.
 */
const localePrefixes: RewriteRule[] = [
${locales
  .slice(1)
  .map((locale) => `  { source: "/${locale}/:path*", destination: "/:path*" },`)
  .join("\n")}
];`
    : ""
}

/**
 * Config-level redirects — the Next.js \`redirects()\` equivalent.
 * First match wins and runs before rewrites. Incoming query params are preserved.
 */
export const redirects: RedirectRule[] = ${
  includeExamples
    ? `[
  // The browser moves to /catalog. Use 301/308 only when the move is permanent.
  { source: "/old-catalog", destination: "/catalog", status: 308 },
]`
    : "[]"
};

/**
 * Internal rewrites and explicit external proxies — the \`rewrites()\` equivalent.
 * An internal destination keeps the public URL while matching another app route.
 */
export const rewrites: RewriteRule[] = ${
  includeExamples
    ? `[
${Array.isArray(locales) && locales.length > 1 ? "  ...localePrefixes,\n" : ""}  // /products/alpha renders /items/:slug; cache and canonical logic still see the public path.
  { source: "/products/:slug", destination: "/items/:slug" },
]`
    : Array.isArray(locales) && locales.length > 1
      ? "[...localePrefixes]"
      : "[]"
};

export function createRewrites(gatewayUrl: string): RewriteRule[] {
  ${
    includeExamples
      ? `return [
    ...rewrites,
    // External destinations are server-side proxies. Expose upstream routes one by one;
    // never add a catch-all such as /gateway/:path*.
    { source: "/gateway/menu", destination: new URL("/menu", gatewayUrl).toString() },
  ];`
      : `void gatewayUrl;
  return rewrites;`
  }
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

const readme = (name, title, port, vitePort, standalone, withOps) => `# ${title}

OriginLoom ürün uygulaması. Platform runtime'ı \`@originloom/core\` ve \`@originloom/react\`
paketlerinden gelir; bu repo route tablosunu, ürün kontratlarını, cache kimliğini ve kendi UI'ını
sahiplenir.

## Gereksinimler

- Node.js 22.19 veya üzeri
- Corepack üzerinden pnpm
${standalone ? "- `@originloom/*` paketlerinin bulunduğu registry'ye erişim" : "- OriginLoom monorepo kökünde çalışmak"}

## Kurulum ve ilk çalıştırma

${
  standalone
    ? `Bu uygulama ayrı bir repository olarak üretildi. \`--registry\` kullanıldıysa kökteki
\`.npmrc\` yalnız \`@originloom/*\` paketlerini ilgili registry'ye yönlendirir; authentication
bilgilerini repository'ye yazmayın.

\`\`\`bash
corepack enable
pnpm install
pnpm e2e:install

# Commit/PR açmadan önce tüm kalite kapısını doğrulayın.
pnpm ci

# SSR, Vite ve mock gateway'i birlikte başlatır.
pnpm dev
\`\`\`

İlk kurulumdan sonra \`pnpm-lock.yaml\` dosyasını repository'ye ekleyin. Gerçek gateway'e geçmeden
önce mock verilerle çalışan route'ları kontrol edin.`
    : `Bu uygulama OriginLoom monorepo içindeki \`apps/${name}\` workspace'idir. Komutları repository
kökünden çalıştırın:

\`\`\`bash
corepack enable
pnpm install
pnpm --filter ${name} e2e:install
pnpm --filter ${name} ci
pnpm --filter ${name} dev
\`\`\``
}

| Servis              | Adres/port                        | Not                                      |
| ------------------- | --------------------------------- | ---------------------------------------- |
| SSR uygulaması      | \`http://127.0.0.1:${port}\`       | Browser'ın açacağı adres                 |
| Vite dev server     | \`http://127.0.0.1:${vitePort}\`   | Client modülleri; doğrudan açmayın       |
| Mock gateway        | \`.env.development:GATEWAY_URL\`   | \`pnpm dev\` otomatik başlatır          |
| Metrics/operations  | \`:${port + 6000}\`                | Public ingress'e açılmamalıdır           |

Gerçek entegrasyonda \`.env.development\` içindeki \`GATEWAY_URL\` değerini değiştirin ve
\`mock-gateway/server.mjs\` payload'larını gerçek kontratlarla karşılaştırın. Production secret'larını
dosyaya yazmak yerine secret manager/CI üzerinden verin.

## Çalışan örnekler

- \`/catalog\`: normalize query paramı cache key'e giren sayfalı liste
- \`/items/alpha\`: param validation, \`notFound()\`, CMS SEO ve JSON-LD içeren dinamik route
- \`/data-cache\`: cache'siz HTML içinde TTL/SWR ile cache'lenen doğrulanmış gateway verisi
- \`/account\`: never-cache document, BFF session ve defer island
- Dynamic menu: fresh/stale endpoint cache, single-flight refresh ve safe fallback
- \`/live\`: progressive SSR, bounded SSE ve graceful shutdown
- \`/showcase\`: bağımsız TTL ile fragment stitching
- \`/media\`: responsive media ve unoptimized asset teslimi
- \`/old-catalog\`: query-string'i koruyan static \`308\` redirect
- \`/products/alpha\`: browser URL'sini koruyan internal rewrite
- \`/gateway/menu\`: yalnız açıkça izin verilen gateway endpoint'ine external proxy
- \`/legacy-catalog\` ve \`/removed-page\`: mock CMS redirect ve \`410 Gone\`

## Sık kullanılan komutlar

| Komut                 | Açıklama                                                     |
| --------------------- | ------------------------------------------------------------ |
| \`pnpm dev\`            | SSR, Vite ve mock gateway'i birlikte çalıştırır              |
| \`pnpm origin:doctor\`  | Platform/template uyumluluğunu read-only denetler             |
| \`pnpm origin:migrate\` | Upgrade planını dry-run gösterir; \`--apply\` ile uygular       |
| \`pnpm sbom\`           | CycloneDX 1.6 full dependency envanteri üretir                  |
| \`pnpm sbom:prod\`      | Yalnız production dependency envanterini üretir                 |
| \`pnpm dependency-track:publish\` | SBOM'u yükler, analizi bekler ve güvenlik kapısını çalıştırır |
| \`pnpm typecheck\`      | TypeScript kontrolü                                          |
| \`pnpm check:cycles\`   | Import cycle ve katman sınırlarını kontrol eder              |
| \`pnpm test\`           | Unit/integration testlerini çalıştırır                       |
| \`pnpm build\`          | Bundle, gerçek route/cache özeti ve \`dist/originloom-manifest.json\` üretir |
| \`pnpm contracts:fixtures\` | Fixture'ları OpenAPI consumer contract'ına karşı doğrular |
| \`pnpm budget:bundle\`  | Island/client gzip bütçelerini kontrol eder                   |
| \`pnpm lighthouse\`     | Route performance ve accessibility bütçelerini çalıştırır    |
| \`pnpm capacity\`       | Tüm route'larda kademeli kapasite testi ve Markdown/JSON raporu üretir |
| \`pnpm capacity:quick\` | Kapasite runner'ının kısa doğrulama profilini çalıştırır      |
| \`pnpm capacity:profile\` | Seçilen route için ayrı CPU/heap profiling raporu üretir    |
| \`pnpm performance:compare\` | Son kapasite raporunu kabul edilmiş baseline ile karşılaştırır |
| \`pnpm performance:accept\` | İncelenen son full raporu yeni baseline olarak kaydeder       |
| \`pnpm smoke\`          | Built server'ı mock gateway ile probe eder                   |
| \`pnpm ci\`             | Typecheck, cycle, lint, format, test, build ve smoke çalıştırır |
| \`pnpm media\`          | Responsive image/font manifestini üretir                     |
| \`pnpm icons\`          | SVG kaynaklarından typed React icon'ları üretir              |
${
  withOps
    ? `| \`pnpm compose:up\`     | Generated Compose stack'ini başlatır                         |
| \`pnpm loadtest\`       | Load profilini çalıştırıp JSON sonuç üretir                   |
| \`pnpm stress\`         | Stress senaryosunu çalıştırır                                |
| \`pnpm loadtest:compare\` | İki load sonucunu regression açısından karşılaştırır       |
| \`pnpm pentest:readiness\` | Uygulamayı pentest öncesi güvenlik kontrollerinden geçirir |`
    : ""
}

## Yapı

| Yol                       | Sorumluluk                                                               |
| ------------------------- | ------------------------------------------------------------------------ |
| \`server/index.ts\`         | Composition root: runtime, routing, app, metrics ve shutdown              |
| \`server/routes/\`          | Route tanımları: loader, cache, metadata ve React Component               |
| \`server/api/\`             | Public API/BFF ve SSE endpoint'leri                                      |
| \`server/product/\`         | Runtime, document shell, fragments, CSP ve boundary kontratları           |
| \`server/services/\`        | Gateway çağrıları, payload guard'ları ve background worker'lar            |
| \`server/metrics/\`         | Bounded product metric kaynakları                                        |
| \`mock-gateway/\`           | Local fixture; \`pnpm dev\` ve \`pnpm smoke\` otomatik başlatır          |
| \`src/features/\`           | Server-rendered sayfa bileşenleri                                        |
| \`src/islands/\`            | Client etkileşim noktaları; dosya adı island adıdır                       |
| \`src/lib/cache-keys.ts\`   | Cache registry, vary parçaları ve purge transport codec'i                 |
| \`src/routing/rules.ts\`    | Static redirect, internal rewrite ve explicit proxy kuralları             |
| \`server/middleware/\`      | Uygulamanın kendi request kuralları: bakım modu, indeksleme, locale       |
| \`docs/\`                   | Özellik envanteri ve production karar rehberleri                          |
| \`.originloom/project.json\` | Template sürümü, renderer, mode ve uygulanmış migration kimlikleri        |

## Yeni sayfa ekleme

1. Cache'lenecekse \`src/lib/cache-keys.ts\` içine bounded vary parçalarıyla cache tanımı ekleyin.
2. \`server/routes/<sayfa>.tsx\` içinde \`defineRoute\` ile loader, \`pageCache(...)\` ve metadata'yı tanımlayın.
3. Gateway payload'ını \`server/services/\` içinde boyut limiti ve runtime guard ile doğrulayın.
4. Route'u \`server/routes/index.ts\` tablosuna ekleyin; ilk eşleşmenin kazandığını unutmayın.
5. UI'ı \`src/features/\` altına koyun; etkileşim gerekiyorsa küçük bir \`<Island />\` kullanın.
6. Cache, redirect/notFound ve payload rejection davranışları için test ekleyip \`pnpm ci\` çalıştırın.
7. \`pnpm build\` özetinde yeni route'un ve cache stratejisinin göründüğünü doğrulayın.

## Routing ekleme

Static redirect, internal rewrite ve explicit external proxy örnekleri \`src/routing/rules.ts\`
içindedir. CMS redirect ve gone fixture'ları mock gateway'dedir. Kuralların çalışma sırası, query
birleştirme, \`publicPath\` ve güvenlik sınırları için [docs/routing.md](docs/routing.md) rehberini
okuyun. Gateway'e wildcard proxy eklemeyin.

## Özellik rehberleri

Başlangıç noktası [docs/features.md](docs/features.md) dosyasıdır:

- [Auth ve BFF](docs/auth.md)
- [Cache ve fragment stitching](docs/caching.md)
- [Kademeli kapasite testi ve raporlama](docs/capacity.md)
- [Performans kabul politikası, payload bütçeleri ve profiling](docs/performance-acceptance.md)
- [Configuration](docs/configuration.md)
- [Dynamic shell](docs/dynamic-shell.md)
- [Background workers](docs/background-workers.md)
- [Redirect, rewrite ve proxy](docs/routing.md)
- [Linkler](docs/links.md)
- [Middleware](docs/middleware.md)
- [Mutation (form ve yazma uçları)](docs/mutations.md)
- [Streaming ve SSE](docs/streaming.md)
- [SEO](docs/seo.md)
- [SBOM ve Dependency-Track](docs/supply-chain-security.md)
- [Observability](docs/observability.md)
- [TanStack Query kullanımı ve kaldırma](docs/react-query.md)
- [Testing](docs/testing.md)
- [Gateway contract drift](docs/contracts.md)
- [Performance ve accessibility bütçeleri](docs/performance.md)
- [Sürüm yükseltme ve migration](docs/upgrading.md)

## Browser E2E

React template production bundle'ı gerçek Chromium üzerinde doğrulayan Playwright suite'iyle gelir.

\`\`\`bash
pnpm e2e:install       # makine başına bir kez Chromium kurar
pnpm e2e               # app + mock gateway'i yönetip browser testlerini çalıştırır
pnpm e2e:ui            # lokal interaktif hata ayıklama
pnpm e2e:report        # son HTML raporunu açar
\`\`\`

Hazır senaryolar hydration, auth refresh, redirect/rewrite, TanStack Query recovery, SSE lifecycle,
CSP/cookie sınırı, accessibility ve JavaScript kapalı SSR'ı kapsar. Test topology'si, CI artifact'leri
ve yeni kritik yol ekleme kuralları için [docs/testing.md](docs/testing.md) dosyasını okuyun.

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

${
  withOps
    ? `## Operations asset'leri

Bu proje \`--with-ops\` ile üretildi. \`OPERATIONS.md\` dosyasını okuyun; image repository, ingress
host'ları, resource limitleri ve secret adları placeholder'dır. Production'a çıkmadan önce Compose,
Kubernetes, Prometheus, load/stress ve pentest readiness adımlarını gerçek ortama göre düzenleyin.`
    : `Deployment manifestleri, load/stress araçları ve pentest readiness gerekiyorsa projeyi
\`--with-ops\` seçeneğiyle yeniden üretmek yerine ilgili asset'leri kontrollü biçimde ekleyin.`
}
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

      - name: Install Chromium
        run: pnpm exec playwright install --with-deps chromium

      # typecheck, cycles, lint, format, tests, browser E2E, build and a smoke run.
      # Playwright and smoke each manage the mock gateway process they need.
      - name: Verify
        run: pnpm run ci

      - name: Upload Playwright report
        if: always() && hashFiles('playwright-report/**') != ''
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14

      - name: Upload Lighthouse reports
        if: always() && hashFiles('.lighthouseci/reports/**') != ''
        uses: actions/upload-artifact@v7
        with:
          name: lighthouse-reports
          path: .lighthouseci/reports/
          retention-days: 14

      - name: Build container
        run: docker build --tag ${name}:\${{ github.sha }} .
`;

const dependencyTrackWorkflow = () => `name: Dependency inventory

on:
  pull_request:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: dependency-track-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  sbom:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      DEPENDENCY_TRACK_URL: \${{ vars.DEPENDENCY_TRACK_URL }}

    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate CycloneDX SBOM
        run: pnpm sbom

      - name: Upload SBOM artifact
        uses: actions/upload-artifact@v7
        with:
          name: cyclonedx-sbom-\${{ github.sha }}
          path: artifacts/sbom/bom.cdx.json
          if-no-files-found: error
          retention-days: 30

      # Pull requests never receive the API key. Push/tag runs publish only after
      # DEPENDENCY_TRACK_URL is configured as a repository variable.
      - name: Publish and enforce Dependency-Track gate
        if: github.event_name != 'pull_request' && env.DEPENDENCY_TRACK_URL != ''
        env:
          DEPENDENCY_TRACK_API_KEY: \${{ secrets.DEPENDENCY_TRACK_API_KEY }}
        run: pnpm dependency-track:publish
`;

const mockGateway = (includeRoutingExamples = false) => `#!/usr/bin/env node
/**
 * Local stand-in for the upstream gateway, so \`pnpm dev\` works before a real one
 * exists. \`origin-dev --gateway\` and \`origin-smoke --gateway\` start it for you.
 *
 * Keep it dumb: fixed data in the shapes the real gateway returns. It is a
 * development fixture, not a second implementation of your backend.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GATEWAY_PORT ?? 4002);
const DELAY_MS = Math.max(0, Number(process.env.MOCK_GATEWAY_DELAY_MS ?? 0) || 0);
${
  includeRoutingExamples
    ? "const LIVE_MESSAGE_DELAY_MS = Math.max(0, Number(process.env.MOCK_LIVE_MESSAGE_DELAY_MS ?? 600) || 0);"
    : ""
}
const stats = { startedAt: new Date().toISOString(), total: 0, byPath: Object.create(null) };

const ITEMS = [
  { slug: "alpha", name: "Alpha", blurb: "İlk örnek kayıt.", seo: { title: "Alpha", description: "Alpha detay sayfası." } },
  { slug: "beta", name: "Beta", blurb: "İkinci örnek kayıt.", seo: { title: "Beta", description: "Beta detay sayfası." } },
  { slug: "gamma", name: "Gamma", blurb: "Üçüncü örnek kayıt.", seo: { title: "Gamma", description: "Gamma detay sayfası." } },
  { slug: "delta", name: "Delta", blurb: "Dördüncü örnek kayıt.", seo: { title: "Delta", description: "Delta detay sayfası." } },
  { slug: "epsilon", name: "Epsilon", blurb: "Beşinci örnek kayıt.", seo: { title: "Epsilon", description: "Epsilon detay sayfası." } },
  { slug: "zeta", name: "Zeta", blurb: "Altıncı örnek kayıt.", seo: { title: "Zeta", description: "Zeta detay sayfası." } },
  { slug: "eta", name: "Eta", blurb: "Yedinci örnek kayıt.", seo: { title: "Eta", description: "Eta detay sayfası." } },
];
const MENU = [
  { label: "Ana sayfa", href: "/" },
  { label: "Katalog", href: "/catalog" },
  { label: "API cache", href: "/data-cache" },
  { label: "Canlı veri", href: "/live" },
];
${
  includeRoutingExamples
    ? `const CMS_ROUTES = new Map([
  ["/legacy-catalog", { destination: "/catalog?source=cms", status: 301 }],
  ["/removed-page", { type: "gone" }],
]);`
    : ""
}
// Answers server/middleware/redirect-rules.ts: "here is the URL a visitor asked
// for — is it still a page, or does it move somewhere?" Keyed by path so a rule
// is not defeated by whatever query string the visitor arrived with.
const ROUTING_DECISIONS = new Map([
  ["/eski-katalog", { action: "redirect", location: "/catalog?source=rules", status: 301 }],
  ["/kampanya", { action: "redirect", location: "/catalog?source=campaign", status: 307 }],
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", \`http://\${req.headers.host ?? "localhost"}\`);

  // Local capacity runner instrumentation. It counts real mock-gateway work so
  // thousands of page requests can be proven to collapse into one data-cache fill.
  if (url.pathname === "/__originloom__/stats") {
    if (req.method === "DELETE") {
      stats.startedAt = new Date().toISOString();
      stats.total = 0;
      stats.byPath = Object.create(null);
      return json(res, 200, { ok: true });
    }
    return json(res, 200, stats);
  }

  stats.total++;
  stats.byPath[url.pathname] = (stats.byPath[url.pathname] ?? 0) + 1;
  if (DELAY_MS) await new Promise((resolveDelay) => setTimeout(resolveDelay, DELAY_MS));

  if (url.pathname === "/items") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("perPage") ?? 3) || 3));
    const start = (page - 1) * perPage;
    return json(res, 200, { items: ITEMS.slice(start, start + perPage), total: ITEMS.length });
  }

  if (url.pathname === "/menu") return json(res, 200, MENU);

  // Where the contact form's endpoint sends what it accepted.
  if (url.pathname === "/enquiries" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, 400, { error: "invalid_json" });
    }
    if (!body?.name || !body?.email || !body?.message) {
      return json(res, 422, { error: "missing_fields" });
    }
    return json(res, 201, { id: "enq-" + Date.now().toString(36) });
  }

${
  includeRoutingExamples
    ? `  // A deliberately slow upstream read for the progressive HTML example.
  // Keeping latency here, rather than in the route, exercises the real
  // app → gateway boundary while React streams the already available shell.
  if (url.pathname === "/live/message") {
    if (LIVE_MESSAGE_DELAY_MS) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, LIVE_MESSAGE_DELAY_MS));
    }
    return json(res, 200, { message: new Date().toISOString() });
  }
`
    : ""
}

  // The product's own routing rules. It always answers: "next" is a decision,
  // not a missing one, so the middleware never has to read 404 as consent.
  if (url.pathname === "/routing/decide") {
    const target = url.searchParams.get("url") ?? "";
    let pathname;
    try {
      pathname = new URL(target).pathname;
    } catch {
      return json(res, 400, { error: "invalid_url" });
    }
    return json(res, 200, ROUTING_DECISIONS.get(pathname) ?? { action: "next" });
  }

${
  includeRoutingExamples
    ? `  if (url.pathname === "/cms/redirects") {
    const rule = CMS_ROUTES.get(url.searchParams.get("path") ?? "");
    return rule ? json(res, 200, rule) : empty(res, 404);
  }
`
    : ""
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

  // Deterministic local refresh contract. Production validates and rotates the
  // real refresh token; this fixture accepts one documented development value.
  if (url.pathname === "/auth/refresh") {
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, 400, { error: "invalid_json" });
    }
    if (!body || body.refreshToken !== "dev-refresh-token") {
      return json(res, 401, { error: "invalid_refresh_token" });
    }
    return json(res, 200, {
      accessToken: createDevAccessToken(),
      refreshToken: "dev-refresh-token",
    });
  }

  // The real gateway decides who the caller is from the bearer token. Here any
  // token is accepted and none is rejected — enough to exercise both branches of
  // the session flow without a login screen.
  if (url.pathname === "/user/profile") {
    if (!req.headers.authorization) return json(res, 401, { error: "unauthorized" });
    return json(res, 200, { displayName: "Örnek Kullanıcı", initials: "ÖK" });
  }

  if (url.pathname === "/analytics/bot" && req.method === "POST") {
    req.resume();
    return json(res, 202, { accepted: true });
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

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (bytes === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createDevAccessToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "none", typ: "JWT" });
  const payload = encode({ sub: "demo", exp: Math.floor(Date.now() / 1000) + 3600 });
  return [header, payload, "dev"].join(".");
}

${
  includeRoutingExamples
    ? `function empty(res, status = 204) {
  res.writeHead(status, { "cache-control": "no-store" });
  res.end();
}`
    : ""
}

server.listen(PORT, "127.0.0.1", () => {
  if (!process.env.MOCK_GW_QUIET) console.log(\`[mock-gw] http://127.0.0.1:\${PORT}\`);
});
`;

const gatewayContracts = (includeStreaming = false) =>
  `import { defineGatewayContract } from "@originloom/core/gateway-payload";

/**
 * This app's gateway endpoints and the largest response each may return.
 *
 * The budget is a safety limit, not an estimate: an upstream that suddenly
 * answers ten times its usual size is a defect, and reading it would be the
 * failure. The platform knows none of these names — every app writes its own.
 */
export const GatewayContracts = {
  items: defineGatewayContract("items", 262_144),
${includeStreaming ? '  liveMessage: defineGatewayContract("live_message", 4_096),\n' : ""}  menu: defineGatewayContract("menu", 32_768),
  enquiries: defineGatewayContract("enquiries", 4_096),
  profile: defineGatewayContract("profile", 16_384),
  routing: defineGatewayContract("routing", 4_096),
} as const;
`;

const gatewayOpenApi = () =>
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: { title: "OriginLoom consumer gateway contract", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            responses: {
              200: {
                description: "Item page",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/ItemPage" } },
                },
              },
            },
          },
        },
        "/items/{slug}": {
          get: {
            responses: {
              200: {
                description: "Item detail",
                content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } },
              },
            },
          },
        },
        "/live/message": {
          get: {
            responses: {
              200: {
                description: "Deferred live message",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/LiveMessage" } },
                },
              },
            },
          },
        },
        "/menu": {
          get: {
            responses: {
              200: {
                description: "Menu",
                content: { "application/json": { schema: { $ref: "#/components/schemas/Menu" } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          ItemSeo: {
            type: "object",
            required: ["title", "description"],
            properties: {
              title: { type: "string", maxLength: 200 },
              description: { type: "string", maxLength: 500 },
            },
            additionalProperties: true,
          },
          Item: {
            type: "object",
            required: ["slug", "name", "blurb", "seo"],
            properties: {
              slug: { type: "string", maxLength: 100 },
              name: { type: "string", maxLength: 200 },
              blurb: { type: "string", maxLength: 1000 },
              seo: { $ref: "#/components/schemas/ItemSeo" },
            },
            additionalProperties: true,
          },
          ItemPage: {
            type: "object",
            required: ["items", "total"],
            properties: {
              items: { type: "array", maxItems: 100, items: { $ref: "#/components/schemas/Item" } },
              total: { type: "number", minimum: 0 },
            },
            additionalProperties: true,
          },
          LiveMessage: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string", maxLength: 200 } },
            additionalProperties: true,
          },
          Menu: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              required: ["label", "href"],
              properties: {
                label: { type: "string", maxLength: 100 },
                href: { type: "string", maxLength: 500 },
              },
              additionalProperties: true,
            },
          },
        },
      },
    },
    null,
    2,
  ) + "\n";

const gatewayContractConfig = () =>
  JSON.stringify(
    {
      schemaVersion: 2,
      schema: "openapi.json",
      authProfiles: {},
      contracts: [
        {
          id: "items-page",
          operationId: "catalog.list",
          request: { method: "GET", path: "/items?page=1&perPage=3" },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/items-page.json",
            schema: "#/components/schemas/ItemPage",
          },
        },
        {
          id: "item-detail",
          operationId: "catalog.detail",
          request: { method: "GET", path: "/items/alpha" },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/item.json",
            schema: "#/components/schemas/Item",
          },
        },
        {
          id: "live-message",
          operationId: "live.message",
          request: { method: "GET", path: "/live/message" },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/live-message.json",
            schema: "#/components/schemas/LiveMessage",
          },
        },
        {
          id: "menu",
          operationId: "shell.menu",
          request: { method: "GET", path: "/menu" },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/menu.json",
            schema: "#/components/schemas/Menu",
          },
        },
      ],
    },
    null,
    2,
  ) + "\n";

const fixtureItem = {
  slug: "alpha",
  name: "Alpha",
  blurb: "İlk örnek kayıt.",
  seo: { title: "Alpha", description: "Alpha detay sayfası." },
};
const gatewayItemsPageFixture = () =>
  JSON.stringify({ items: [fixtureItem], total: 7 }, null, 2) + "\n";
const gatewayItemFixture = () => JSON.stringify(fixtureItem, null, 2) + "\n";
const gatewayLiveMessageFixture = () =>
  JSON.stringify({ message: "2026-01-01T00:00:00.000Z" }, null, 2) + "\n";
const gatewayMenuFixture = () =>
  JSON.stringify(
    [
      { label: "Ana sayfa", href: "/" },
      { label: "Katalog", href: "/catalog" },
      { label: "API cache", href: "/data-cache" },
      { label: "Canlı veri", href: "/live" },
    ],
    null,
    2,
  ) + "\n";

const performanceBudgets = () =>
  JSON.stringify(
    {
      assetRoot: "dist/client/assets",
      assets: [
        { name: "hydration runtime", pattern: "^hydrate\\.client-.*\\.js$", maxGzipBytes: 70_000 },
        { name: "counter island", pattern: "^counter-.*\\.js$", maxGzipBytes: 5_000 },
        {
          name: "account + React Query island",
          pattern: "^account-panel-.*\\.js$",
          maxGzipBytes: 25_000,
        },
        { name: "live island", pattern: "^live-ticks-.*\\.js$", maxGzipBytes: 5_000 },
      ],
    },
    null,
    2,
  ) + "\n";

const performancePolicy = () =>
  JSON.stringify(
    {
      schemaVersion: 1,
      payloadBudgets: {
        htmlBytes: 102_400,
        totalIslandPropsBytes: 51_200,
        singleIslandPropsBytes: 20_480,
        documentRenderP95Ms: 50,
        gatewayJsonParseP95Ms: 10,
      },
      regression: {
        rpsMedianDropPercent: 10,
        latencyP95IncreasePercent: 20,
        latencyP99IncreasePercent: 25,
        rssPeakIncreasePercent: 20,
        eventLoopP99IncreasePercent: 25,
        serializationIncreasePercent: 20,
        payloadIncreasePercent: 10,
      },
      reliability: { maxCoefficientOfVariationPercent: 10, generatorCpuLimitPercent: 90 },
    },
    null,
    2,
  ) + "\n";

const dependencyTrackConfig = (name) =>
  JSON.stringify(
    {
      schemaVersion: 1,
      projectName: name,
      bomPath: "artifacts/sbom/bom.cdx.json",
      autoCreate: true,
      isLatest: true,
      tags: ["originloom", "javascript"],
      gate: {
        enabled: true,
        failOnSeverity: "critical",
        failOnPolicyViolation: "fail",
        timeoutSeconds: 300,
        pollIntervalSeconds: 2,
      },
    },
    null,
    2,
  ) + "\n";

const lighthouseConfig = (port) =>
  JSON.stringify(
    {
      urls: [`http://127.0.0.1:${port}/`, `http://127.0.0.1:${port}/catalog?page=1`],
      runs: 2,
      thresholds: {
        performanceScore: 0.85,
        accessibilityScore: 1,
        largestContentfulPaintMs: 2_500,
        cumulativeLayoutShift: 0.1,
        totalBlockingTimeMs: 300,
        scriptTransferBytes: 160_000,
      },
    },
    null,
    2,
  ) + "\n";

const stagingContractWorkflow = (name) => `name: Staging gateway contracts

on:
  workflow_dispatch:
  schedule:
    - cron: "17 4 * * 1-5"

jobs:
  contracts:
    if: \${{ vars.ENABLE_STAGING_CONTRACT_TESTS == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      CONTRACT_BASE_URL: \${{ secrets.STAGING_GATEWAY_URL }}
      CONTRACT_BEARER_TOKEN: \${{ secrets.STAGING_GATEWAY_BEARER_TOKEN }}
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22.19.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Verify ${name} consumer contracts against staging
        run: pnpm run contracts:staging
`;

const profileService =
  () => `import { gatewayFetchForRequest, releaseGatewayResponse } from "@originloom/core/adapters/gateway";
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
    if (response.status === 401 || response.status === 403) {
      await releaseGatewayResponse(response);
      return { kind: "unauthorized" };
    }
    if (!response.ok) {
      await releaseGatewayResponse(response);
      return { kind: "unavailable" };
    }

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
  app.post("/api/internal/refresh", async (c) => {
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
      const paths = ["/", "/catalog", ...items.map((item) => \`/items/\${item.slug}\`)];
      return paths.map((path) => ({ path }));
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

const liveStreamMetrics = () => `import {
  counterLines,
  type CounterMap,
  escapeLabel,
  increment,
} from "@originloom/core/metrics/primitives";

const outcomes: CounterMap = new Map();
let activeConnections = 0;

export function observeLiveStreamConnection(
  outcome:
    | "accepted"
    | "closed"
    | "global_limit"
    | "invalid_request"
    | "ip_limit"
    // A response nobody read: the slot was handed back without a stream.
    | "never_started",
): void {
  increment(outcomes, \`outcome="\${escapeLabel(outcome)}"\`);
}

export function setLiveStreamActiveConnections(value: number): void {
  activeConnections = Math.max(0, value);
}

export function liveStreamMetricLines(): string[] {
  return [
    ...counterLines(
      "app_live_stream_connections_total",
      "Live stream connection lifecycle by bounded outcome",
      outcomes,
    ),
    "# HELP app_live_stream_active_connections Current live stream connections",
    "# TYPE app_live_stream_active_connections gauge",
    \`app_live_stream_active_connections \${activeConnections}\`,
  ];
}
`;

const productConfigFile = (
  includeMenuCache = false,
) => `import { config, numberEnv } from "@originloom/core/config";
import { assertPositiveInteger } from "@originloom/core/config-validation";

/**
 * This app's own environment. The platform reads its own variables (ports,
 * cache, gateway, timeouts); everything specific to this product lives here so
 * there is one place to look — and one place to validate.
 */
export const productConfig = {
  /** Items per catalog page. Part of the cache key, so changing it changes cached HTML. */
  catalogPageSize: numberEnv("CATALOG_PAGE_SIZE", 3),
${
  includeMenuCache
    ? `  /** Public endpoint-data cache: fresh TTL followed by stale-while-revalidate window. */
  menuCacheTtl: numberEnv("MENU_CACHE_TTL", 14_400),
  menuCacheSwr: numberEnv("MENU_CACHE_SWR", 86_400),
  /** Short demo TTL: uncached /data-cache HTML keeps using this public API snapshot. */
  featuredItemsCacheTtl: numberEnv("FEATURED_ITEMS_CACHE_TTL", 10),
  featuredItemsCacheSwr: numberEnv("FEATURED_ITEMS_CACHE_SWR", 30),
`
    : ""
}  /** Shown in the footer; optional in development, required in production. */
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || undefined,
  liveStreamMaxConnections: numberEnv("LIVE_STREAM_MAX_CONNECTIONS", 1_000),
  liveStreamMaxConnectionsPerIp: numberEnv("LIVE_STREAM_MAX_CONNECTIONS_PER_IP", 5),
  liveStreamMaxDurationMs: numberEnv("LIVE_STREAM_MAX_DURATION_MS", 300_000),
  liveStreamHeartbeatMs: numberEnv("LIVE_STREAM_HEARTBEAT_MS", 15_000),
  botAnalyticsQueueCapacity: numberEnv("BOT_ANALYTICS_QUEUE_CAPACITY", 1_000),
  botAnalyticsBatchSize: numberEnv("BOT_ANALYTICS_BATCH_SIZE", 25),
  botAnalyticsFlushMs: numberEnv("BOT_ANALYTICS_FLUSH_MS", 250),
  botAnalyticsDrainTimeoutMs: numberEnv("BOT_ANALYTICS_DRAIN_TIMEOUT_MS", 3_000),
} as const;

export type ProductConfig = typeof productConfig;

/**
 * Runs at startup through \`validateConfig([validateProductConfig])\`. Fail here,
 * loudly, rather than at the first request that needs the value.
 */
export function validateProductConfig(): void {
  assertPositiveInteger("CATALOG_PAGE_SIZE", productConfig.catalogPageSize);
${
  includeMenuCache
    ? `  assertPositiveInteger("MENU_CACHE_TTL", productConfig.menuCacheTtl);
  if (!Number.isFinite(productConfig.menuCacheSwr) || productConfig.menuCacheSwr < 0) {
    throw new Error("MENU_CACHE_SWR must be a non-negative number");
  }
  assertPositiveInteger("FEATURED_ITEMS_CACHE_TTL", productConfig.featuredItemsCacheTtl);
  if (
    !Number.isFinite(productConfig.featuredItemsCacheSwr) ||
    productConfig.featuredItemsCacheSwr < 0
  ) {
    throw new Error("FEATURED_ITEMS_CACHE_SWR must be a non-negative number");
  }
`
    : ""
}  if (productConfig.catalogPageSize > 100) {
    throw new Error("CATALOG_PAGE_SIZE above 100 would make one page too large to cache well");
  }
  if (config.isProduction && !productConfig.supportEmail) {
    throw new Error("SUPPORT_EMAIL is required in production");
  }
  for (const [name, value] of [
    ["LIVE_STREAM_MAX_CONNECTIONS", productConfig.liveStreamMaxConnections],
    ["LIVE_STREAM_MAX_CONNECTIONS_PER_IP", productConfig.liveStreamMaxConnectionsPerIp],
    ["LIVE_STREAM_MAX_DURATION_MS", productConfig.liveStreamMaxDurationMs],
    ["LIVE_STREAM_HEARTBEAT_MS", productConfig.liveStreamHeartbeatMs],
    ["BOT_ANALYTICS_QUEUE_CAPACITY", productConfig.botAnalyticsQueueCapacity],
    ["BOT_ANALYTICS_BATCH_SIZE", productConfig.botAnalyticsBatchSize],
    ["BOT_ANALYTICS_FLUSH_MS", productConfig.botAnalyticsFlushMs],
    ["BOT_ANALYTICS_DRAIN_TIMEOUT_MS", productConfig.botAnalyticsDrainTimeoutMs],
  ] as const) {
    assertPositiveInteger(name, value);
  }
  if (productConfig.liveStreamMaxConnectionsPerIp > productConfig.liveStreamMaxConnections) {
    throw new Error("LIVE_STREAM_MAX_CONNECTIONS_PER_IP must not exceed the global limit");
  }
  if (productConfig.liveStreamHeartbeatMs >= productConfig.liveStreamMaxDurationMs) {
    throw new Error("LIVE_STREAM_HEARTBEAT_MS must be lower than LIVE_STREAM_MAX_DURATION_MS");
  }
  if (productConfig.botAnalyticsBatchSize > productConfig.botAnalyticsQueueCapacity) {
    throw new Error("BOT_ANALYTICS_BATCH_SIZE must not exceed BOT_ANALYTICS_QUEUE_CAPACITY");
  }
  if (productConfig.botAnalyticsDrainTimeoutMs >= config.shutdownTimeoutMs) {
    throw new Error("BOT_ANALYTICS_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS");
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

const enquiryApi = () => `import { logError } from "@originloom/core/logger";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { submitEnquiry } from "@server/services/enquiries";
import type { Hono } from "hono";

/**
 * A write anyone on the internet can reach, so it carries the two things a
 * public mutation always needs: a same-origin check and a rate limit.
 *
 * \`requireSameOriginMutation\` is the CSRF defence. It reads Fetch Metadata and
 * falls back to Origin/Referer — what a browser sends for a real form submission
 * and what an attacker's page cannot forge. That is why this form needs no token.
 *
 * The per-IP limit is deliberately small: a person fills this in once. The global
 * limit keeps one abusive network from spending the whole budget.
 */
const ENQUIRY_POLICY: PublicApiPolicy = {
  name: "enquiry",
  windowMs: 60_000,
  globalLimit: 120,
  ipLimit: 5,
  requireSameOriginMutation: true,
};

export function mountEnquiryApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/enquiries", async (c) => {
    const request = contextRequest(c);
    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", ENQUIRY_POLICY);
    if (denied) return denied;

    const form = await readForm(request);
    if (!form) return seeOther(FALLBACK_RETURN, "invalid");

    // The page tells the endpoint where to send the visitor back to. Without it
    // the answer is always the same URL, which is wrong the moment the same form
    // is served from more than one path — a localized site, for instance.
    const returnTo = sameSitePath(form.get("returnTo")) ?? FALLBACK_RETURN;

    const enquiry = readEnquiry(form);
    // Post/Redirect/Get: the browser lands on a GET, so a reload never resubmits
    // and the outcome is a URL the visitor can share, bookmark or go back to.
    if (!enquiry) return seeOther(returnTo, "invalid");

    try {
      await submitEnquiry(enquiry, request.signal);
    } catch (error) {
      logError(error, { msg: "enquiry submission failed" });
      return seeOther(returnTo, "failed");
    }
    return seeOther(returnTo, "sent");
  });
}

const FALLBACK_RETURN = "/contact";

async function readForm(request: Request): Promise<FormData | null> {
  if (!request.headers.get("content-type")?.includes("form")) return null;
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** Untrusted form input: bounded and shaped, and nothing else is carried through. */
function readEnquiry(form: FormData) {
  const name = trimmed(form.get("name"), 80);
  const email = trimmed(form.get("email"), 160);
  const message = trimmed(form.get("message"), 2_000);
  if (!name || !email || !message || !EMAIL.test(email)) return null;
  return { name, email, message };
}

/**
 * A destination the browser supplied is a destination an attacker can supply.
 * Only a path on this site is accepted — never an absolute URL, never a
 * protocol-relative one, and never a query of its own.
 */
function sameSitePath(value: FormDataEntryValue | null): string | null {
  const path = trimmed(value, 200);
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return /[?#\\s]/.test(path) ? null : path;
}

// Deliberately loose: an address is validated by sending to it, not by a regexp.
// This only rejects what is obviously not one.
const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/;

function trimmed(value: FormDataEntryValue | null, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function seeOther(path: string, status: "sent" | "invalid" | "failed"): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: \`\${path}?status=\${status}\`,
      "cache-control": "private, no-store",
    },
  });
}
`;

const enquiryService =
  () => `import { gatewayFetch, requireGatewayOk } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

export type Enquiry = { name: string; email: string; message: string };
export type EnquiryReceipt = { id: string };

const INVALID = "Enquiry gateway returned an invalid payload";

/** The endpoint owns validation; this owns the upstream call and its contract. */
export async function submitEnquiry(enquiry: Enquiry, signal: AbortSignal): Promise<EnquiryReceipt> {
  const response = await gatewayFetch("/enquiries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(enquiry),
    signal,
  });
  // requireGatewayOk drains the body before it throws, so a failed call never
  // leaves a socket held open.
  await requireGatewayOk(response, "Enquiry gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.enquiries, INVALID);
  return requireGatewayPayload(GatewayContracts.enquiries, payload, isReceipt, INVALID);
}

function isReceipt(value: unknown): value is EnquiryReceipt {
  return isRecord(value) && isBoundedString(value.id, 100);
}
`;

const contactRoute = () => `import { defineRoute } from "@originloom/react/lib/types";

import { ContactPage, type EnquiryStatus } from "~/features/contact/contact-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

const STATUSES: readonly EnquiryStatus[] = ["sent", "invalid", "failed"];

/**
 * The form's own page, and the page the endpoint redirects back to.
 *
 * Never cached: what it renders depends on the outcome of a write. The status
 * comes from an allowlist rather than the raw query string — a value echoed into
 * the page is a value the caller gets to choose.
 */
export default defineRoute({
  path: "/contact",
  cache: pageCache(PageCacheId.contact),
  loader: async (ctx) => {
    const requested = ctx.url.searchParams.get("status");
    return {
      data: {
        status: STATUSES.find((candidate) => candidate === requested) ?? null,
        // The browser-visible path, so the form returns to the page it was on.
        publicPath: ctx.publicPath,
      },
    };
  },
  generateMetadata: () => ({
    title: "İletişim",
    description: "Sorularınızı bize iletin.",
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "contact"),
  Component: ({ data }) => <ContactPage status={data.status} publicPath={data.publicPath} />,
});
`;

const contactPage = () => `export type EnquiryStatus = "sent" | "invalid" | "failed";

const TONES: Record<EnquiryStatus, string> = {
  sent: "text-emerald-700",
  invalid: "text-amber-700",
  failed: "text-rose-700",
};

const TEXT = {
  title: "İletişim",
  name: "Adınız",
  email: "E-posta",
  message: "Mesajınız",
  submit: "Gönder",
  sent: "Mesajınız alındı. En kısa sürede döneceğiz.",
  invalid: "Formu kontrol edip tekrar gönderin.",
  failed: "Şu an gönderemedik. Biraz sonra tekrar deneyin.",
};


/**
 * A plain form: method="post" to a real endpoint, no client JavaScript involved.
 * It works before hydration, without hydration, and when a bundle fails to load.
 */
export function ContactPage({
  status,
  publicPath,
}: {
  status: EnquiryStatus | null;
  publicPath: string;
}) {
  const text = TEXT;
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{text.title}</h1>
      {status ? (
        <p className={\`rounded-md bg-slate-50 px-4 py-3 text-sm \${TONES[status]}\`} role="status">
          {text[status]}
        </p>
      ) : null}
      <form method="post" action="/api/enquiries" className="space-y-4">
        {/* Where the endpoint sends the visitor back to. The same form served
            from a second path — another language, say — returns to that path. */}
        <input type="hidden" name="returnTo" value={publicPath} />
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{text.name}</span>
          <input
            name="name"
            required
            maxLength={80}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{text.email}</span>
          <input
            type="email"
            name="email"
            required
            maxLength={160}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{text.message}</span>
          <textarea
            name="message"
            required
            rows={5}
            maxLength={2000}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
        >
          {text.submit}
        </button>
      </form>
    </div>
  );
}
`;

const enquiryApiTest =
  () => `import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountEnquiryApi } from "@server/api/enquiries";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ submitEnquiry: vi.fn() }));
vi.mock("@server/services/enquiries", () => ({ submitEnquiry: mocks.submitEnquiry }));
vi.mock("@originloom/core/logger", () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Each case gets its own client IP: the per-IP limiter outlives a single test. */
function app(clientIp: string) {
  const instance = new Hono<{ Variables: AppVariables }>();
  instance.use("*", async (c, next) => {
    c.set("clientIp", clientIp);
    await next();
  });
  mountEnquiryApi(instance);
  return instance;
}

function submission(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  };
}

const valid = { name: "Ada", email: "ada@example.com", message: "Merhaba" };

describe("enquiry endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitEnquiry.mockResolvedValue({ id: "enq-1" });
  });

  it("accepts a same-origin submission and answers with a redirect, not a body", async () => {
    const response = await app("10.0.0.1").request("/api/enquiries", submission(valid));

    // Post/Redirect/Get: reloading the result must not resubmit the form.
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/contact?status=sent");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.submitEnquiry).toHaveBeenCalledWith(valid, expect.anything());
  });

  it("returns the visitor to the page they submitted from", async () => {
    const response = await app("10.0.0.6").request(
      "/api/enquiries",
      submission({ ...valid, returnTo: "/en/contact" }),
    );

    expect(response.headers.get("location")).toBe("/en/contact?status=sent");
  });

  it("refuses a return path that would leave the site", async () => {
    const response = await app("10.0.0.7").request(
      "/api/enquiries",
      submission({ ...valid, returnTo: "https://evil.example/x" }),
    );

    expect(response.headers.get("location")).toBe("/contact?status=sent");
  });

  it("rejects a cross-site submission without reaching the gateway", async () => {
    const response = await app("10.0.0.2").request(
      "/api/enquiries",
      submission(valid, { "sec-fetch-site": "cross-site" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.submitEnquiry).not.toHaveBeenCalled();
  });

  it("refuses input it cannot trust", async () => {
    const response = await app("10.0.0.3").request(
      "/api/enquiries",
      submission({ ...valid, email: "not-an-address" }),
    );

    expect(response.headers.get("location")).toBe("/contact?status=invalid");
    expect(mocks.submitEnquiry).not.toHaveBeenCalled();
  });

  it("tells the visitor the truth when the gateway fails", async () => {
    mocks.submitEnquiry.mockRejectedValue(new Error("gateway down"));

    const response = await app("10.0.0.4").request("/api/enquiries", submission(valid));

    expect(response.headers.get("location")).toBe("/contact?status=failed");
  });

  it("stops one caller from spending the endpoint's budget", async () => {
    const instance = app("10.0.0.5");
    for (let attempt = 0; attempt < 5; attempt++) {
      await instance.request("/api/enquiries", submission(valid));
    }

    const limited = await instance.request("/api/enquiries", submission(valid));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});
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
