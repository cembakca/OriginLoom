/**
 * Templates for `origin-create-app`.
 *
 * Every file here is app-owned by design. Anything generic — cache, middleware,
 * SSR pipeline, island runtime, metadata engine — stays in @originloom/core and
 * @originloom/react and is consumed, never copied.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  dependencyTrackWorkflow,
  githubWorkflow,
  packageManagerFieldValue,
  readmeCommandTable,
  readmeInstallBlock,
  packageManagerRequirements,
  standaloneDockerfile,
  dockerfileRunner,
  yarnrcYaml,
} from "./package-manager-templates.mjs";
import {
  assertKnownPackageManager,
  ciScript,
  dependencyOverrideField,
  e2eServerScript,
  nativeBuildPolicy,
  pnpmDependencyOverridesYaml,
  trustedNativeBuildPackages,
  pnpmAllowBuildYamlKey,
} from "../lib/package-manager.mjs";
import { applyPluginsToTemplates, resolvePluginIds } from "./plugins/apply.mjs";
import { pluginsById } from "./plugins/registry.mjs";
import {
  compareVersions,
  PROJECT_SCHEMA_VERSION,
  TOOLING_VERSION,
} from "../upgrade/compatibility.mjs";
import { migrations } from "../upgrade/migrations.mjs";
import { renderSkills } from "./skills.mjs";

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
 *   plugins?: string[];
 *   withOps?: boolean;
 *   packageManager?: "pnpm" | "npm" | "yarn";
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
  plugins: requestedPlugins,
  withOps = false,
  packageManager = "pnpm",
}) {
  assertKnownPackageManager(packageManager);
  const pluginIds = resolvePluginIds({ plugins: requestedPlugins, withOps });
  const hasWithOps = pluginIds.includes("with-ops");
  // Standalone apps live in their own repo and depend on the published
  // @originloom/* packages; workspace apps sit in apps/<name> and link them
  // via workspace:*. The two modes differ only in how they reach the packages
  // and how they build — the app source they generate is identical.
  const standalone = mode === "standalone";
  const pluginContext = {
    name,
    title,
    port,
    metricsPort,
    vitePort,
    mode,
    version,
    templateVersion,
    registry,
    plugins: pluginIds,
    packageManager,
  };
  const baseFiles = {
    // npm config is not inherited from parent directories, so an app that
    // installs @originloom/* from somewhere other than npmjs carries its own.
    ...(registry ? { ".npmrc": npmrc(registry) } : {}),
    ".originloom/project.json": projectMetadata({
      templateVersion,
      platformRange: mode === "workspace" ? "workspace:*" : version,
      mode,
      plugins: pluginIds,
      packageManager,
    }),
    "package.json": packageJson(name, { standalone, version, packageManager }),
    ...(standalone && packageManager === "pnpm"
      ? { "pnpm-workspace.yaml": standalonePnpmWorkspace() }
      : {}),
    ...(standalone && packageManager === "yarn" ? { ".yarnrc.yml": yarnrcYaml() } : {}),
    "tsconfig.json": tsconfig(standalone),
    "eslint.config.js": eslintConfig(),
    ".prettierrc.json": asset("prettierrc.json"),
    ".prettierignore": prettierIgnore(),
    "vite.config.ts": viteConfig(vitePort),
    "vite.server.config.ts": viteServerConfig(),
    "public/README.md": asset("public/README.md"),
    "public/test.img": asset("public/test.img"),
    "vitest.config.ts": vitestConfig(name),
    "playwright.config.ts": playwrightConfig(name, port, metricsPort),
    ".env.development": envDevelopment(name, port, metricsPort, vitePort, true),
    ".env.production": envProduction(port, metricsPort, true),
    "README.md": readme(name, title, port, vitePort, standalone, hasWithOps, packageManager),
    "docs/auth.md": asset("docs/auth.md"),
    "docs/background-workers.md": asset("docs/background-workers.md"),
    "docs/caching.md": asset("docs/caching.md"),
    "docs/cache-purge.md": asset("docs/cache-purge.md"),
    "docs/capacity.md": asset("docs/capacity.md"),
    "docs/configuration.md": asset("docs/configuration.md"),
    "docs/dynamic-shell.md": asset("docs/dynamic-shell.md"),
    "docs/features.md": asset("docs/features.md"),
    "docs/links.md": asset("docs/links.md"),
    "docs/lists.md": asset("docs/lists.md"),
    "docs/middleware.md": asset("docs/middleware.md"),
    "docs/mutations.md": asset("docs/mutations.md"),
    "docs/observability.md": asset("docs/observability.md"),
    "docs/react-query.md": asset("docs/react-query.md"),
    "docs/route-params.md": asset("docs/route-params.md"),
    "docs/referrals.md": asset("docs/referrals.md"),
    "docs/routing.md": asset("docs/routing.md"),
    "docs/seo.md": asset("docs/seo.md"),
    "docs/supply-chain-security.md": asset("docs/supply-chain-security.md"),
    "docs/streaming.md": asset("docs/streaming.md"),
    "docs/testing.md": asset("docs/testing.md"),
    "docs/tools.md": asset("docs/tools.md"),
    "docs/analytics.md": asset("docs/analytics.md"),
    "docs/webhooks.md": asset("docs/webhooks.md"),
    "docs/contracts.md": asset("docs/contracts.md"),
    "docs/performance.md": asset("docs/performance.md"),
    "docs/performance-acceptance.md": asset("docs/performance-acceptance.md"),
    "docs/runtime-performance.md": asset("docs/runtime-performance.md"),
    "docs/upgrading.md": asset("docs/upgrading.md"),
    Dockerfile: dockerfile(name, port, standalone, packageManager),
    ".dockerignore": asset("dockerignore"),
    ".gitignore": asset("gitignore"),
    ".nvmrc": asset("nvmrc"),
    ".editorconfig": asset("editorconfig"),
    ".github/workflows/ci.yml": githubWorkflow(name, packageManager),
    ".github/workflows/dependency-track.yml": dependencyTrackWorkflow(packageManager),
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
    "server/middleware/experiments.ts": experimentsMiddleware(),
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
    "server/api/referrals.ts": referralApi(),
    "server/api/webhooks.ts": webhookApi(),
    "server/api/calculator.ts": calculatorApi(),
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
    "server/routes/calculator.tsx": calculatorRoute(),
    "server/routes/guides.tsx": guidesRoute(),
    "server/routes/guide-detail.tsx": guideDetailRoute(),
    "server/routes/catalog-category.tsx": catalogCategoryRoute(),
    "server/routes/data-cache.tsx": dataCacheRoute(),
    "server/routes/no-cache.tsx": noCacheRoute(),
    "src/features/no-cache/no-cache-page.tsx": noCachePage(),
    "server/routes/item-detail.tsx": itemDetailRoute(),
    "server/routes/account.tsx": accountRoute(),
    "server/routes/contact.tsx": contactRoute(),
    "src/features/contact/contact-page.tsx": contactPage(),
    "server/routes/live.tsx": liveRoute(),
    "server/services/shell-data.ts": serverShellData(),
    "server/services/menu.ts": menuService(),
    "server/services/bot-analytics.ts": botAnalyticsService(),
    "server/services/items.ts": itemsService(),
    "server/services/referrals.ts": referralService(),
    "server/services/calculator.ts": calculatorService(),
    "server/services/guides.ts": guidesService(),
    "server/services/route-domains.ts": routeDomainsService(),
    "server/services/sitemap.ts": sitemapService(),
    "server/services/featured-items.ts": featuredItemsService(),
    "server/services/live-message.ts": liveMessageService(),
    "server/services/profile.ts": profileService(),
    "server/services/gateway-contracts.ts": gatewayContracts(true),
    "contracts/openapi.json": gatewayOpenApi(),
    "contracts/gateway-contracts.json": gatewayContractConfig(),
    "contracts/fixtures/items-page.json": gatewayItemsPageFixture(),
    "contracts/fixtures/item-reviews.json": gatewayReviewsFixture(),
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
    "src/islands/page-analytics.tsx": pageAnalyticsIsland(),
    "src/islands/loan-calculator.tsx": calculatorIsland(),
    "src/islands/account-panel.tsx": accountPanelIsland(),
    "src/islands/live-ticks.tsx": liveTicksIsland(),
    "src/features/home/home-page.tsx": homePage(),
    "src/features/showcase/showcase-page.tsx": showcasePage(),
    "src/features/showcase/server-time-fragment.tsx": serverTimeFragment(),
    "src/features/catalog/catalog-page.tsx": catalogPage(),
    "src/features/calculator/calculator-page.tsx": calculatorPage(),
    "src/features/guides/guides-page.tsx": guidesPage(),
    "src/features/guides/guide-page.tsx": guidePage(),
    "src/lib/metadata/jsonld-article.ts": articleJsonLdLib(),
    "src/features/data-cache/data-cache-page.tsx": dataCachePage(),
    "src/features/items/item-detail-page.tsx": itemDetailPage(),
    "src/features/live/live-page.tsx": livePage(),
    "src/components/layout/root-layout.tsx": rootLayout(title),
    "src/components/ui/responsive-image.tsx": responsiveImageComponent(),
    "src/lib/shell-data.ts": libShellData(),
    "src/lib/cache-keys.ts": cacheKeys(),
    "src/lib/pagination.ts": paginationLib(),
    "src/lib/catalog-query.ts": catalogQueryLib(),
    "src/lib/quote-query.ts": quoteQueryLib(),
    "src/lib/calculator-query.ts": calculatorQueryLib(),
    "src/lib/query/hooks/use-session.ts": sessionQueryHook(),
    "src/lib/query/keys.ts": queryKeys(),
    "src/lib/metadata/site-defaults.ts": siteDefaults(title),
    "src/lib/menu.ts": menuLib(),
    "src/routing/rules.ts": routingRules(true),
    "src/styles/globals.css": globalsCss(standalone),
    "src/global.d.ts": globalDts(),

    "tests/home.test.ts": homeTest(),
    "tests/middleware.test.ts": middlewareTest(),
    "tests/experiments.test.ts": experimentsMiddlewareTest(),
    "tests/experiment-cache.test.ts": experimentCacheTest(),
    "tests/tracking-id-leak.test.ts": trackingLeakTest(),
    "tests/analytics-chain.test.ts": analyticsChainTest(),
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
    "tests/no-cache.test.ts": noCacheTest(),
    "tests/gateway-identity.test.ts": gatewayIdentityCoverageTest(),
    "tests/catalog-query.test.ts": catalogQueryTest(),
    "tests/quote-query.test.ts": quoteQueryTest(),
    "tests/referrals.test.ts": referralApiTest(),
    "tests/webhooks.test.ts": webhookApiTest(),
    "tests/calculator.test.ts": calculatorTest(),
    "tests/guides.test.ts": guidesTest(),
    "tests/detail-seo.test.ts": detailSeoTest(),
    "tests/cache-purge.test.ts": cachePurgeApiTest(),
    "tests/route-domains.test.ts": routeDomainsTest(),
    "tests/sitemap.test.ts": sitemapServiceTest(),
    "tests/item-detail-reviews.test.ts": itemDetailReviewsTest(),
    "e2e/critical-paths.spec.ts": criticalPathsE2e(port, metricsPort),
    "e2e/analytics.spec.ts": analyticsE2e(),
    "e2e/accessibility.spec.ts": accessibilityE2e(),
    "e2e/ssr.no-js.spec.ts": noJavaScriptE2e(),

    // Claude Code integration — an always-loaded project guide, a pre-approved
    // permission allowlist, and the skill set. Identical in both modes; the
    // generated app source they describe is too.
    "CLAUDE.md": asset("generated-claude.md"),
    ".claude/settings.json": claudeSettings(),
    ...renderSkills(),
  };
  const merged = applyPluginsToTemplates(baseFiles, pluginIds, pluginContext, pluginsById);
  if (merged["README.md"]?.includes("readme-ops-table")) {
    merged["README.md"] = merged["README.md"].replace(
      /\n?<!-- @originloom:hook readme-ops-table -->\n?/,
      "\n",
    );
  }
  return merged;
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
          "Bash(pnpm dev:mock)",
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

/** @param {{ standalone: boolean; version: string; packageManager?: "pnpm" | "npm" | "yarn" }} opts */
const packageJson = (name, { standalone, version, packageManager = "pnpm" }) => {
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
      packageManager: packageManagerFieldValue(packageManager),
      engines: { node: ">=22.19.0" },
      ...dependencyOverrideField(packageManager),
      ...nativeBuildPolicy(packageManager),
      scripts: {
        "origin:doctor": "origin-doctor",
        "origin:migrate": "origin-migrate",
        sbom: "origin-sbom",
        "sbom:prod": "origin-sbom --prod",
        "audit:prod": "origin-audit",
        "dependency-track:publish": "origin-dependency-track publish",
        "dependency-track:gate": "origin-dependency-track gate",
        dev: "origin-dev",
        "dev:mock": "origin-dev --gateway mock-gateway/server.mjs",
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
          "contracts:scaffold": "origin-scaffold-gateway",
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
        "e2e:server": e2eServerScript(packageManager),
        "e2e:ui": "playwright test --ui",
        "e2e:report": "playwright show-report",
        "e2e:install": "playwright install --with-deps chromium",
        // @originloom:hook package-json-scripts
        // What CI runs, in one command, so it can be run locally too.
        ci: ciScript(packageManager),
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
        hono: "^4.12.34",
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
${trustedNativeBuildPackages.map((name) => `  ${pnpmAllowBuildYamlKey(name)}: true`).join("\n")}

# Autocannon 8 still declares hyperid 3, which pulls the unsupported uuid 8.
# Hyperid 4 preserves the API and uses randomUUID instead.
# Remaining lines pin transitive production audit findings (fast-uri, js-yaml, nanoid).
overrides:
${pnpmDependencyOverridesYaml()}
`;

const projectMetadata = ({
  templateVersion,
  platformRange,
  mode,
  plugins = [],
  packageManager = "pnpm",
}) =>
  JSON.stringify(
    {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      templateVersion,
      platformRange,
      renderer: "react",
      mode,
      packageManager,
      generatedBy: "@originloom/tooling",
      plugins: [...plugins].sort(),
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
              // The consent tool, so the analytics chain is the real one. The
              // container is deliberately left unset: loading GTM would reach
              // the internet, and these tests run offline.
              EFILLI_SCRIPT_URL: mockGatewayURL + "/vendor/consent.js",
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
    await expect(page.getByRole("heading", { name: "Krediler" })).toBeVisible();

    await page.goto("/products/konut-avantaj?source=e2e");
    await expect(page).toHaveURL(/\\/products\\/konut-avantaj\\?source=e2e$/);
    await expect(page.getByRole("heading", { name: "Konut Avantaj" })).toBeVisible();
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
    // Land inside a fresh window before measuring. A load that falls in the
    // stale-while-revalidate window is served immediately *and* starts a
    // background refresh, so the snapshot can legitimately change between two
    // loads — which is the behaviour under test elsewhere, not here.
    await expect
      .poll(
        async () => {
          await page.goto("/data-cache");
          return (await page.getByTestId("api-cache-status").textContent()) ?? "";
        },
        { timeout: 15_000 },
      )
      .toContain("FRESH");

    const firstResponse = await page.goto("/data-cache");
    expect(firstResponse?.headers()["x-cache"]).toBe("BYPASS");
    const firstRenderedAt = await page.getByTestId("page-rendered-at").textContent();
    const firstFetchedAt = await page.getByTestId("api-fetched-at").textContent();

    await page.waitForTimeout(10);
    const secondResponse = await page.reload();
    expect(secondResponse?.headers()["x-cache"]).toBe("BYPASS");
    await expect(page.getByTestId("api-cache-status")).toContainText("FRESH");
    // The document is rendered again — and the upstream snapshot behind it is not.
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

const analyticsE2e = () => `import { expect, test } from "@playwright/test";

/**
 * The dataLayer as a browser actually builds it.
 *
 * Every other test here asserts the *script* order in the head, or the builders
 * in isolation. This one loads the page, lets the scripts run, and reads
 * \`window.dataLayer\` — the only thing that answers "is the order right", and the
 * only thing that catches an ordering bug caused by *when* a script runs rather
 * than where it is written.
 */
type Entry = Record<string, unknown>;

async function dataLayer(page: import("@playwright/test").Page): Promise<Entry[]> {
  return page.evaluate(() => (window as unknown as { dataLayer?: Entry[] }).dataLayer ?? []);
}

function events(entries: Entry[]): string[] {
  return entries.map((entry) => String(entry.event ?? Object.keys(entry)[0] ?? "?"));
}

test.describe("dataLayer", () => {
  test("builds in one order, whatever the visitor arrived with", async ({ browser }) => {
    // A visitor with no cookies — what an incognito window is.
    const fresh = await browser.newContext();
    const firstVisit = await fresh.newPage();
    await firstVisit.goto("/");
    await expect.poll(async () => events(await dataLayer(firstVisit))).toContain("GAVirtual");
    const firstOrder = events(await dataLayer(firstVisit));
    await fresh.close();

    // The same browser again, now carrying the cookies a first visit set.
    const returning = await browser.newContext();
    const warmup = await returning.newPage();
    await warmup.goto("/");
    await warmup.close();
    const secondVisit = await returning.newPage();
    await secondVisit.goto("/");
    await expect.poll(async () => events(await dataLayer(secondVisit))).toContain("GAVirtual");
    const secondOrder = events(await dataLayer(secondVisit));
    await returning.close();

    // The bug this replaces: the chain waited for the consent tool's event, and
    // a returning visitor's decision is already known while a first visit's is
    // not — so the two produced different sequences. Nothing waits now, and the
    // order is a property of the document rather than of the visitor.
    expect(firstOrder).toEqual(secondOrder);
  });

  test("puts the page view after the tracking id, in head order", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => events(await dataLayer(page))).toContain("GAVirtual");

    const order = events(await dataLayer(page));
    const at = (name: string) => order.indexOf(name);

    // Efilli announces itself first because it is the first script in the head.
    expect(at("efilli.consent")).toBe(0);
    expect(at("efilli_essential_granted")).toBe(1);
    // Then the visitor's own id — a value, not an event.
    expect(at("userTrackingId")).toBeGreaterThan(at("efilli_essential_granted"));
    // Then React: where the visit started, then the view itself.
    expect(at("originalLocation")).toBeGreaterThan(at("userTrackingId"));
    expect(at("GAVirtual")).toBeGreaterThan(at("originalLocation"));
  });

  test("carries the visitor's own id, and never another's", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => events(await dataLayer(page))).toContain("userTrackingId");

    const entries = await dataLayer(page);
    const pushed = entries.find((entry) => "userTrackingId" in entry)?.userTrackingId;
    const cookie = (await page.context().cookies()).find(
      (entry) => entry.name === "user_tracking_id",
    )?.value;

    // Read from this browser's cookie, not rendered into the shared-cached HTML.
    expect(pushed).toBe(cookie);
    expect(await page.content()).not.toContain(String(pushed));
  });

  test("lets gtm.dom through once the page view has landed", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => events(await dataLayer(page))).toContain("GAVirtual");

    // The container is not configured here, so GTM never fires this itself.
    await page.evaluate(() => {
      (window as unknown as { dataLayer: Record<string, unknown>[] }).dataLayer.push({
        event: "gtm.dom",
      });
    });

    const order = events(await dataLayer(page));
    expect(order.indexOf("gtm.dom")).toBeGreaterThan(order.indexOf("GAVirtual"));
  });
});
`;

const accessibilityE2e = () => `import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of ["/", "/catalog", "/calculator", "/guides", "/data-cache", "/account"] as const) {
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
  const response = await page.goto("/catalog");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Krediler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Konut Avantaj" })).toBeVisible();
  await expect(page.getByText("Sayfa 1 / 3")).toBeVisible();

  await page.getByRole("link", { name: "Konut Avantaj" }).click();
  await expect(page).toHaveURL(/\\/items\\/konut-avantaj$/);
  await expect(page.getByRole("heading", { name: "Konut Avantaj" })).toBeVisible();
  // The second gateway call is part of the document, not something a script
  // fetches afterwards — so it is here with JavaScript switched off.
  await expect(page.getByRole("heading", { name: "Değerlendirmeler" })).toBeVisible();
  // And so is the quote: the amount comes from the URL, not from a script.
  await expect(page.getByRole("heading", { name: "Örnek ödeme planı" })).toBeVisible();
});

test("catalog filters work without JavaScript and stay in the URL", async ({ page }) => {
  await page.goto("/catalog");

  // Filters are links. With scripting off that is the difference between a
  // catalogue you can browse and one you cannot.
  await page
    .getByRole("navigation", { name: "Kategori" })
    .getByRole("link", { name: /^Konut kredisi/ })
    .click();

  await expect(page).toHaveURL(/\\/catalog\\?category=konut$/);
  await expect(page.getByRole("link", { name: "İhtiyaç Hızlı" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Konut Avantaj" })).toBeVisible();
});

test("one page keeps one URL", async ({ page, request }) => {
  // ?page=1 is the catalog under a second name, and a second name is a duplicate
  // for a crawler. It is corrected permanently rather than served.
  const canonicalised = await request.get("/catalog?page=1", { maxRedirects: 0 });
  expect(canonicalised.status()).toBe(308);
  const location = canonicalised.headers().location;
  expect(location).toBeDefined();
  expect(new URL(location ?? "", "http://localhost").pathname).toBe("/catalog");

  // A page number that was never valid is not page 1 — it is a 404.
  expect((await request.get("/catalog?page=abc")).status()).toBe(404);
  // And a page past the end is a 404 too, not an empty 200.
  expect((await request.get("/catalog?page=99")).status()).toBe(404);

  await page.goto("/catalog?category=konut");
  await expect(page.getByRole("heading", { name: "Krediler" })).toBeVisible();
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
# Analytics. Both come from the environment: a deployment points at its own
# properties, and a checkout without them is not silently measuring people.
# Without EFILLI_SCRIPT_URL the container is not loaded either — no consent
# tool, no tag manager. In development the mock gateway stands in for Efilli.
# GTM_CONTAINER_ID=GTM-XXXXXXX
# EFILLI_SCRIPT_URL=https://cdn.efilli.com/…
# ANALYTICS_TRACKING_ID_KEY=userTrackingId
# ANALYTICS_FIELD_PREFIX=
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
  // Preloaded rather than discovered: the page-analytics chunk is what releases
  // the gtm.dom/gtm.load the head bootstrap is holding.
  const assets = readAssets({ clientEntry: "${clientEntry}", eagerIslands: ["page-analytics"] });
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
      metricsPort: config.metricsEnabled ? config.metricsPort : null,
    });
  });
  // The operations listener is never exposed publicly, so cache inspection and
  // purge live here rather than on the site itself. CACHE_PURGE_SECRET gates them.
  //
  // Off in development: a laptop rarely needs /metrics, and a dev command that
  // binds two ports collides with the next project twice as often. Turn it on
  // with METRICS_ENABLED=true when you actually want to look.
  if (config.metricsEnabled) {
    const metricsApp = createMetricsApp({ mounts: (app) => mountCachePurgeApi(app) });
    metricsServer = serve({ fetch: metricsApp.fetch, port: config.metricsPort });
  }

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
    const rule = await decide(ctx.url, ctx.request);
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

async function decide(url: URL, request: Request): Promise<MiddlewareRedirect | null> {
  const signal = request.signal;
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    // No identity, deliberately. The answer is a property of the URL — the same
    // for every visitor, cached by path here and almost certainly upstream too.
    // This step also runs \`before-auth\`, so there is no tracking id and no
    // resolved client IP yet: sending the header set would carry one device type
    // and two empty values, which reads like a per-visitor call and is not one.
    const response = await gatewayFetch(
      \`/routing/decide?url=\${encodeURIComponent(url.toString())}\`,
      { signal: request.signal },
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
  // An A/B experiment, off by default. Turning it on is this line plus its
  // import — and it doubles the cache entries of every page that reads the
  // bucket, which is the trade it exists to make visible:
  //
  //   import { experimentsMiddleware } from "./experiments";
  //   …
  //   experimentsMiddleware,
  //
  // See server/middleware/experiments.ts and docs/middleware.md.
  // @originloom:hook middleware-exports
];
`;

const experimentsMiddleware = () => `import { defineMiddleware } from "@originloom/core/middleware";

/**
 * Two values, and the whole reason \`cacheVary\` exists.
 *
 * \`variant\` changes what the page renders, so it has to fragment the shared HTML
 * cache — which is the default: every value in \`values\` enters the key unless
 * you say otherwise. Forget that and the first visitor to miss the cache decides
 * which variant everybody sees, for the whole TTL. Nothing errors; the
 * experiment simply reports that both arms behave identically, because they were
 * the same page.
 *
 * \`campaign\` is the opposite case. It is read by analytics and by nothing that
 * renders, so splitting the cache on it would multiply entries of byte-identical
 * HTML — one per campaign code anyone has ever linked with. \`cacheVary: []\` opts
 * it out, and that opt-out is only correct while no loader reads it.
 */
export const experimentsMiddleware = defineMiddleware({
  name: "experiments",
  // Needs the tracking id, which the session step resolves — so, after it.
  phase: "before-render",
  // Documents only. An endpoint has no HTML to vary and no bucket to be in.
  matcher: ["/:path*"],
  exclude: ["/api/:path*"],
  handler: (ctx) => {
    const values: Record<string, string> = { variant: bucketFor(ctx.trackingId) };

    const campaign = sanitizeCampaign(ctx.url.searchParams.get("utm_campaign"));
    if (campaign) values.campaign = campaign;

    return {
      values,
      // Everything in \`values\` varies the cache by default; this names the
      // exceptions. \`variant\` is deliberately absent from the list — it varies.
      cacheVary: Object.keys(values).filter((name) => name !== "campaign"),
    };
  },
});

/**
 * The same visitor lands in the same bucket, on every page, across visits.
 *
 * Deriving it from the tracking id rather than rolling a die per request is what
 * makes the experiment measurable: a visitor who sees A on one page and B on the
 * next is not in either arm. A visitor with no tracking id — a first request
 * whose cookie is still being minted, a crawler — gets the control arm rather
 * than a random one, so nothing an experiment does can change what a crawler
 * indexes.
 */
function bucketFor(trackingId: string | undefined): "a" | "b" {
  if (!trackingId) return "a";
  let hash = 0;
  for (const character of trackingId) hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003;
  return hash % 2 === 0 ? "a" : "b";
}

/**
 * Bounded and allowlisted by shape.
 *
 * A campaign code is attacker-controlled: it arrives in a URL anyone can send.
 * It reaches analytics and, on a page that reads it, the cache key — so a
 * 4 KB one, or one with a newline in it, is refused rather than carried.
 */
function sanitizeCampaign(raw: string | null): string | undefined {
  if (!raw || raw.length > 60) return undefined;
  return /^[a-z0-9_-]+$/i.test(raw) ? raw.toLowerCase() : undefined;
}
`;

const analyticsChainTest = () => `import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { analyticsSequence } from "@server/product/analytics";
import { installProductRuntime } from "@server/product/runtime";
import { routes } from "@server/routes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const page = {
  items: [],
  total: 0,
  page: 1,
  totalPages: 1,
  facets: { categories: [] },
  query: { category: "all", sortBy: "recommended" },
  seoInfo: { title: "Krediler", friendlyUrl: "/catalog" },
};

const VISITOR = "d1195a49-29da-457b-bb56-bfa9ce641601";

describe("the analytics chain", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.gatewayFetchWithIdentity.mockImplementation(async () => Response.json(page));
    installProductRuntime();
    await closeCache();
    await initCache();
  });
  afterEach(async () => {
    await closeCache();
  });

  it("orders the head steps: consent, tracking id, queue, container", () => {
    const consent = analyticsSequence.indexOf("consent.js");
    const trackingId = analyticsSequence.indexOf("user_tracking_id");
    const queue = analyticsSequence.indexOf("gtm.dom");

    // Script order, which the browser guarantees. The queue comes before the
    // container because it wraps \`dataLayer.push\` and can only hold what is
    // pushed after it is installed.
    expect(consent).toBeGreaterThan(-1);
    expect(trackingId).toBeGreaterThan(consent);
    expect(queue).toBeGreaterThan(trackingId);
  });

  it("waits for no consent event, so the order is the same for every visitor", () => {
    // An earlier version waited for \`efilli.consent\`. A returning visitor gets
    // that during execution and a first visit gets it when the banner is
    // answered — ten seconds later, or never — so the same site produced one
    // sequence in a normal window and another in an incognito one.
    expect(analyticsSequence).not.toContain("awaitDataLayerEvent");
    expect(analyticsSequence).not.toContain("efilli.consent");
  });

  it("reports a missing consent tool rather than quietly changing behaviour", async () => {
    vi.resetModules();
    const previous = { env: process.env.NODE_ENV, gtm: process.env.GTM_CONTAINER_ID };
    process.env.NODE_ENV = "production";
    process.env.GTM_CONTAINER_ID = "GTM-TEST123";
    delete process.env.EFILLI_SCRIPT_URL;
    const { logger } = await import("@originloom/core/logger");
    const reported = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const { analyticsSequence: withoutConsent } = await import("@server/product/analytics");

    // The container is not gated on the consent tool: deciding which tags may
    // fire is the consent platform's job. Refusing to load GTM because a
    // variable is unset would turn one misconfiguration into zero measurement,
    // which reads as "no traffic" and is found weeks later.
    expect(withoutConsent).toContain("googletagmanager.com");
    expect(reported).toHaveBeenCalledWith(expect.stringContaining("EFILLI_SCRIPT_URL"));

    reported.mockRestore();
    process.env.NODE_ENV = previous.env;
    if (previous.gtm === undefined) delete process.env.GTM_CONTAINER_ID;
    else process.env.GTM_CONTAINER_ID = previous.gtm;
    vi.resetModules();
  });

  it("reads the tracking id in the browser rather than rendering it", async () => {
    const app = createApp({
      assets: { js: "/assets/entry.client.js", css: [], fonts: [] },
      routes,
      readinessCheck: async () => true,
    });

    const html = await (
      await app.request("http://app.local/catalog", {
        headers: {
          cookie: \`user_tracking_id=\${VISITOR}\`,
          "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        },
      })
    ).text();

    // The document is shared-cached: an id rendered into it would belong to
    // whoever filled the cache and would then be served to everybody else.
    expect(html).not.toContain(VISITOR);
    // What is in the HTML is the code that reads the cookie, which is the same
    // for every visitor and therefore cacheable.
    expect(html).toContain("user_tracking_id");
  });

  it("mounts the island that pushes the page view", async () => {
    const app = createApp({
      assets: { js: "/assets/entry.client.js", css: [], fonts: [] },
      routes,
      readinessCheck: async () => true,
    });

    const html = await (await app.request("http://app.local/catalog")).text();

    // Without this the route's pageMeta is computed on every request and thrown
    // away — the chain looks wired and measures nothing.
    expect(html).toContain('data-island="page-analytics"');
    expect(html).toContain("data-eager");
  });
});
`;

const trackingLeakTest = () => `import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { productMiddleware } from "@server/middleware";
import { installProductRuntime } from "@server/product/runtime";
import { routes } from "@server/routes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const page = {
  items: [],
  total: 0,
  page: 1,
  totalPages: 1,
  facets: { categories: [] },
  query: { category: "all", sortBy: "recommended" },
  seoInfo: { title: "Krediler", friendlyUrl: "/catalog" },
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36";
// Two ids the experiment middleware puts in the same bucket, so the second
// request is a cache hit on the first one's HTML — the case under test.
const FIRST = "00000000-0000-4000-8000-000000000000";
const SECOND = "00000000-0000-4000-8000-000000000002";

function app() {
  return createApp({
    assets: { js: "/assets/entry.client.js", css: [], fonts: [] },
    routes,
    middleware: productMiddleware,
    readinessCheck: async () => true,
  });
}

function visit(instance: ReturnType<typeof app>, trackingId?: string) {
  return instance.request("http://app.local/catalog", {
    headers: {
      "user-agent": UA,
      ...(trackingId ? { cookie: \`user_tracking_id=\${trackingId}\` } : {}),
    },
  });
}

/**
 * The question every shared HTML cache has to answer: can one visitor's identity
 * reach another visitor's browser?
 *
 * It cannot, for three separate reasons, and this asserts all three because any
 * one of them could be undone by an ordinary-looking change.
 */
describe("a visitor's tracking id and the shared cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.gatewayFetchWithIdentity.mockImplementation(async () => Response.json(page));
    installProductRuntime();
    await closeCache();
    await initCache();
  });
  afterEach(async () => {
    await closeCache();
  });

  it("never puts the tracking id in the HTML", async () => {
    const instance = app();

    const html = await (await visit(instance, FIRST)).text();

    // The id goes to the gateway as a request header. The moment a loader puts
    // it in route data — a "welcome back" line, a debug field — it is in the
    // cached body and belongs to whoever gets that entry next.
    expect(html).not.toContain(FIRST);
  });

  it("does not hand the first visitor's id to the second", async () => {
    const instance = app();

    await visit(instance, FIRST);
    const second = await visit(instance, SECOND);
    const html = await second.text();

    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(html).not.toContain(FIRST);
    // The cache stores the body and nothing else, so no Set-Cookie can be
    // replayed out of an entry.
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("still mints a new visitor their own cookie on a cache hit", async () => {
    const instance = app();
    await visit(instance, FIRST);

    // A visitor with no cookie is served the shared HTML and still gets an
    // identity of their own: the session step runs per request, after the cache
    // lookup, and its Set-Cookie is attached to this response only.
    let hit: Response | undefined;
    for (let attempt = 0; attempt < 8 && !hit; attempt++) {
      const response = await visit(instance);
      await response.text();
      if (response.headers.get("x-cache") === "HIT") hit = response;
    }

    expect(hit, "expected a cookieless visitor to land on the warm entry").toBeDefined();
    expect(hit?.headers.get("set-cookie")).toMatch(/^user_tracking_id=/);
    // And a response that sets a cookie is never stored — not by a browser, not
    // by a CDN. Without this the Set-Cookie could be reused for someone else.
    expect(hit?.headers.get("cache-control")).toBe("private, no-store");
  });
});
`;

const experimentCacheTest = () => `import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { productMiddleware } from "@server/middleware";
import { experimentsMiddleware } from "@server/middleware/experiments";
import { installProductRuntime } from "@server/product/runtime";
import { routes } from "@server/routes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const item = {
  slug: "konut-avantaj",
  name: "Konut Avantaj",
  blurb: "Uzun vadeli konut finansmanı.",
  category: "konut",
  provider: "Örnek Bank",
  interestRate: 2.79,
  minAmount: 50_000,
  maxAmount: 5_000_000,
  terms: [12, 24, 36],
  seo: { title: "Konut Avantaj", description: "detay" },
};
const page = {
  items: [item],
  total: 1,
  page: 1,
  totalPages: 1,
  facets: { categories: [{ value: "all", count: 1 }] },
  query: { category: "all", sortBy: "recommended" },
  seoInfo: { title: "Krediler", friendlyUrl: "/catalog" },
};

/**
 * The whole point of \`cacheVary\`, asserted against real cached HTML.
 *
 * A unit test on the middleware can only say what it returned. This one puts two
 * visitors from different buckets through the app and checks that the second one
 * is not served the first one's page — which is the failure \`cacheVary\` prevents
 * and the one nothing else would catch.
 */
function visitor(trackingId: string): RequestInit {
  return {
    headers: {
      cookie: \`user_tracking_id=\${trackingId}\`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    },
  };
}

// Two ids the middleware's hash puts in different arms.
const IN_A = "00000000-0000-4000-8000-000000000000";
const IN_B = "00000000-0000-4000-8000-000000000001";

function app() {
  return createApp({
    assets: { js: "/assets/entry.client.js", css: [], fonts: [] },
    routes,
    // Registered here rather than in the app's list: the experiment ships off,
    // because a dimension nobody uses still doubles every entry.
    middleware: [...productMiddleware, experimentsMiddleware],
    readinessCheck: async () => true,
  });
}

async function bucketOf(instance: ReturnType<typeof app>, trackingId: string): Promise<string> {
  const html = await (await instance.request("http://app.local/catalog", visitor(trackingId))).text();
  // React SSR puts comment markers around an interpolated expression, so the
  // bucket is not adjacent to the label in the HTML.
  return /deney kovası: (?:<!-- -->)?([ab])/.exec(html)?.[1] ?? "?";
}

describe("an experiment inside cached HTML", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Menu and catalog both go through this; the menu degrading to empty is
    // fine here, the catalogue is what the test renders.
    mocks.gatewayFetchWithIdentity.mockImplementation(async () => Response.json(page));
    installProductRuntime();
    await closeCache();
    await initCache();
  });
  afterEach(async () => {
    await closeCache();
  });

  it("serves each bucket its own page instead of whichever was cached first", async () => {
    const instance = app();

    const first = await bucketOf(instance, IN_A);
    const second = await bucketOf(instance, IN_B);

    // The two ids land in different arms; without cacheVary the second request
    // would be a cache hit on the first one's HTML and both would read the same.
    expect(first).not.toBe(second);
  });

  it("reuses one entry for two visitors in the same bucket", async () => {
    const instance = app();

    const first = await instance.request("http://app.local/catalog", visitor(IN_A));
    const second = await instance.request("http://app.local/catalog", visitor(IN_A));

    // Varying is not the same as not caching: the bucket splits the cache in
    // two, it does not disable it.
    expect(first.headers.get("x-cache")).toBe("MISS");
    expect(second.headers.get("x-cache")).toBe("HIT");
  });

  it("does not split the cache on a campaign code", async () => {
    const instance = app();

    await instance.request("http://app.local/catalog", visitor(IN_A));
    const campaigned = await instance.request(
      "http://app.local/catalog?utm_campaign=bahar-2026",
      visitor(IN_A),
    );

    // Byte-identical HTML. One entry per campaign code anyone has ever linked
    // with is how a cache stops being one.
    expect(campaigned.headers.get("x-cache")).toBe("HIT");
  });
});
`;

const experimentsMiddlewareTest =
  () => `import type { MiddlewareContext, MiddlewareResult } from "@originloom/core/middleware";
import { experimentsMiddleware } from "@server/middleware/experiments";
import { describe, expect, it } from "vitest";

function context(url: string, trackingId?: string): MiddlewareContext {
  const request = new Request(url);
  const parsed = new URL(url);
  return {
    request,
    url: parsed,
    publicPath: parsed.pathname,
    params: {},
    clientIp: "127.0.0.1",
    values: {},
    ...(trackingId ? { trackingId } : {}),
    cookie: () => undefined,
    header: (name) => request.headers.get(name) ?? undefined,
  } as MiddlewareContext;
}

function run(url: string, trackingId?: string): MiddlewareResult {
  return experimentsMiddleware.handler(context(url, trackingId)) as MiddlewareResult;
}

const VISITOR = "9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b";

describe("the experiment bucket", () => {
  it("puts the same visitor in the same bucket on every page", () => {
    const home = run("http://app.local/", VISITOR);
    const catalog = run("http://app.local/catalog", VISITOR);

    // A visitor who sees A on one page and B on the next is in neither arm, and
    // the experiment measures nothing.
    expect(home.values?.variant).toBe(catalog.values?.variant);
  });

  it("varies the shared cache on the bucket", () => {
    const result = run("http://app.local/", VISITOR);

    // Without this the first visitor to miss the cache decides which variant
    // everybody sees for the whole TTL — silently, and the experiment reports
    // that both arms behave identically.
    expect(result.cacheVary).toContain("variant");
  });

  it("gives a visitor with no tracking id the control arm", () => {
    // A crawler, or the very first request while the cookie is still being
    // minted. Random would mean an experiment can change what gets indexed.
    expect(run("http://app.local/").values?.variant).toBe("a");
  });

  it("keeps an analytics-only value out of the cache key", () => {
    const result = run("http://app.local/?utm_campaign=Bahar-2026", VISITOR);

    expect(result.values?.campaign).toBe("bahar-2026");
    // Splitting on this would multiply entries of byte-identical HTML — one per
    // campaign code anyone has ever linked with.
    expect(result.cacheVary).not.toContain("campaign");
  });

  it("refuses a campaign code that was never a campaign code", () => {
    // It arrives in a URL anyone can send, and it reaches analytics.
    expect(run("http://app.local/?utm_campaign=" + "x".repeat(200), VISITOR).values?.campaign).toBeUndefined();
    expect(run("http://app.local/?utm_campaign=bad%0Avalue", VISITOR).values?.campaign).toBeUndefined();
  });
});
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

const mocks = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  releaseGatewayResponse: vi.fn(),
}));

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
    // No identity: the answer is a property of the URL, not of the visitor, and
    // this step runs before-auth where no identity exists yet. The cancellation
    // signal still travels, so an abandoned request does not keep the call alive.
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
import calculator from "./calculator";
import catalog from "./catalog";
import catalogCategory from "./catalog-category";
import contact from "./contact";
import dataCache from "./data-cache";
import guideDetail from "./guide-detail";
import guides from "./guides";
import home from "./home";
import itemDetail from "./item-detail";
import live from "./live";
import media from "./media";
import noCache from "./no-cache";
import showcase from "./showcase";

/** The route table. Order matters: the first match wins. */
export const routes: Route[] = [
  home,
  catalog,
  catalogCategory,
  calculator,
  guides,
  guideDetail,
  dataCache,
  itemDetail,
  account,
  contact,
  live,
  noCache,
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

const item = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Katalog",
  url: "/catalog",
  displayOrder: 1,
  mobileDisplayOrder: 2,
  ...over,
});

const payload = {
  headerItems: [item({ subMenuItemList: [item({ id: 11, parentId: 1, name: "Araçlar" })] })],
  footerItems: [item({ id: 100, name: "İletişim", url: "/contact" })],
};

function request(path = "/") {
  return new Request(\`http://app.local\${path}\`);
}

describe("menu data cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(null);
    mocks.write.mockResolvedValue(true);
    mocks.deleteKey.mockResolvedValue(true);
    mocks.gatewayFetch.mockImplementation(async () => Response.json(payload));
  });

  it("serves a fresh cache hit without calling the gateway", async () => {
    const menu = await getMenu(request(), "Desktop");
    mocks.read.mockResolvedValue({ body: JSON.stringify(menu), state: "fresh" });
    vi.clearAllMocks();
    mocks.read.mockResolvedValue({ body: JSON.stringify(menu), state: "fresh" });

    await expect(getMenu(request("/again"), "Desktop")).resolves.toEqual(menu);
    expect(mocks.gatewayFetch).not.toHaveBeenCalled();
  });

  it("keeps one entry per device, and tells the gateway which one it wants", async () => {
    await getMenu(request("/d"), "Desktop");
    await getMenu(request("/m"), "Mobile");

    const keys = mocks.write.mock.calls.map((call) => call[0] as string);
    // Desktop and mobile order the same items differently, so one cached copy
    // cannot serve both.
    expect(keys).toEqual(["menu:Desktop", "menu:Mobile"]);
    // No identity headers here on purpose — this answer is shared by every
    // visitor on that device. \`device\` is the one dimension that matters.
    const devices = mocks.gatewayFetch.mock.calls.map(
      (call) => (call[1] as { headers: Record<string, string> }).headers.device,
    );
    expect(devices).toEqual(["Desktop", "Mobile"]);
  });

  it("falls back to the drawer list when the gateway ships only one", async () => {
    const menu = await getMenu(request(), "Desktop");

    // A gateway that returns no hamburgerItems means the drawer shows the header
    // items — not that the drawer is empty.
    expect(menu.hamburgerItems).toEqual(menu.headerItems);
  });

  it("drops the whole menu when one item's URL cannot be trusted", async () => {
    mocks.gatewayFetch.mockImplementation(async () =>
      Response.json({ headerItems: [item({ url: "javascript:alert(1)" })] }),
    );

    // Rendering the other items and quietly skipping this one would put a menu
    // on the page that is missing an entry nobody notices. Failing is louder.
    await expect(getMenu(request(), "Desktop")).resolves.toEqual({
      headerItems: [],
      hamburgerItems: [],
      footerItems: [],
    });
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("refuses a menu nested deeper than it will render", async () => {
    const deep = item({ subMenuItemList: [item({ subMenuItemList: [item({ subMenuItemList: [item()] })] })] });
    mocks.gatewayFetch.mockImplementation(async () =>
      Response.json({ headerItems: [deep] }),
    );

    // Depth is bounded because this data becomes a render: an upstream loop
    // would otherwise become an unbounded one here.
    await expect(getMenu(request(), "Desktop")).resolves.toEqual({
      headerItems: [],
      hamburgerItems: [],
      footerItems: [],
    });
  });

  it("renders without a menu rather than failing the page", async () => {
    mocks.gatewayFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

    // A missing menu costs navigation; a thrown one costs the page.
    await expect(getMenu(request(), "Desktop")).resolves.toEqual({
      headerItems: [],
      hamburgerItems: [],
      footerItems: [],
    });
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("replaces a corrupt cache entry instead of trusting it", async () => {
    mocks.read.mockResolvedValue({ body: "{not json", state: "fresh" });

    await getMenu(request(), "Desktop");

    expect(mocks.deleteKey).toHaveBeenCalledWith("menu:Desktop");
    expect(mocks.gatewayFetch).toHaveBeenCalled();
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
      category: "ihtiyac",
      provider: "Örnek Bank",
      interestRate: 3.1,
      minAmount: 10_000,
      maxAmount: 500_000,
      terms: [12, 24, 36],
      seo: { title: "Alpha", description: "Alpha detay sayfası." },
    },
  ],
  total: 1,
  page: 1,
  totalPages: 1,
  facets: { categories: [{ value: "all", count: 1 }] },
  query: { category: "all", sortBy: "recommended" },
  seoInfo: { title: "Katalog", friendlyUrl: "/catalog" },
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
    // The request goes with it: the identity headers the gateway sees on every
    // call are read from it, not passed around separately.
    // The whole query goes to the service, not a page number: filters and
    // sorting are part of what identifies this snapshot.
    expect(mocks.listItems).toHaveBeenCalledWith(expect.any(URLSearchParams), expect.any(Request));
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

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));

vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

describe("gateway-backed progressive message", () => {
  beforeEach(() => mocks.gatewayFetchWithIdentity.mockReset());

  it("reads and validates the deferred gateway payload", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(Response.json({ message: "gateway-ready" }));
    const request = new Request("http://app.local/live");

    await expect(getLiveMessage(request)).resolves.toBe("gateway-ready");
    // The identity — tracking id, client IP, device — rides along because the
    // service was handed the request instead of a bare signal.
    expect(mocks.gatewayFetchWithIdentity).toHaveBeenCalledWith(request, "/live/message");
  });

  it("rejects an invalid payload instead of streaming untrusted data", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(Response.json({ message: 42 }));
    await expect(getLiveMessage(new Request("http://app.local/live"))).rejects.toThrow(
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

const itemsService = () => `import {
  gatewayFetchWithIdentity,
  releaseGatewayResponse,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import { config } from "@originloom/core/config";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { parseSeoInfo } from "@originloom/shared/lib/metadata/schema";
import type { SeoInfo } from "@originloom/shared/lib/metadata/types";
import { isBoundedArray, isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

export type ItemSeo = { title: string; description: string };

/**
 * A credit product as the catalogue lists it.
 *
 * The rate and the limits are the product's; the monthly payment is not — that
 * depends on what the visitor asked for, so it lives on the quote instead.
 */
export type Item = {
  slug: string;
  name: string;
  blurb: string;
  category: string;
  provider: string;
  interestRate: number;
  minAmount: number;
  maxAmount: number;
  terms: number[];
  seo: ItemSeo;
};

export type ItemReview = { author: string; rating: number; comment: string };

/**
 * What this product costs for the amount and term the visitor asked for.
 *
 * Computed upstream, not here: an interest formula duplicated in the frontend is
 * a second source of truth for a number people make decisions with, and the two
 * copies diverge the first time the business changes a rounding rule.
 */
export type ItemQuote = {
  amount: number;
  term: number;
  monthlyPayment: number;
  totalPayment: number;
  annualCostRate: number;
};

/**
 * A detail *page*, not just the record it is about.
 *
 * \`seoInfo\` is page-level and belongs to whoever writes the copy, so it arrives
 * beside the entity rather than inside it — the same shape the list endpoint
 * returns, and the same one \`generateMetaDataForPageWithSeoInfo\` consumes.
 */
export type ItemDetail = { item: Item; quote: ItemQuote; seoInfo: SeoInfo };

/** One selectable value and how many items carry it, as the gateway counted them. */
export type ItemFacet = { value: string; count: number };

export type ItemPage = {
  items: Item[];
  total: number;
  page: number;
  totalPages: number;
  facets: { categories: ItemFacet[] };
  /** What the gateway understood the filters to be, after its own normalization. */
  query: { category: string; sortBy: string };
  /** Page title, description and indexing flags — owned by the CMS, not the route. */
  seoInfo: SeoInfo;
};

const INVALID = "Items gateway returned an invalid payload";

/**
 * Server-only data orchestration. Loaders call these; nothing here runs in the
 * browser, so this is where upstream calls, validation and error mapping live.
 *
 * The search params are passed through rather than rebuilt: the caller has
 * already normalized them (see \`~/lib/catalog-query\`), and normalizing twice in
 * two places is how the cache key and the request drift apart.
 */
export async function listItems(search: URLSearchParams, request: Request): Promise<ItemPage> {
  const response = await gatewayFetchWithIdentity(request, \`/items?\${search}\`);
  await requireGatewayOk(response, "Items gateway returned");

  // Bounded read against this endpoint's contract, then a runtime guard: gateway
  // JSON is untrusted input, and a TypeScript type is not a check.
  const payload = await readGatewayJson(response, GatewayContracts.items, INVALID);
  return requireGatewayPayload(GatewayContracts.items, payload, isItemPage, INVALID);
}

export async function getItem(
  slug: string,
  search: URLSearchParams,
  request: Request,
): Promise<ItemDetail | null> {
  const response = await gatewayFetchWithIdentity(
    request,
    \`/items/\${encodeURIComponent(slug)}?\${search}\`,
  );
  // A missing item is data, not a failure — the route turns it into notFound().
  if (response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  await requireGatewayOk(response, "Items gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.items, INVALID);
  return requireGatewayPayload(GatewayContracts.items, payload, isItemDetail, INVALID);
}

/**
 * The slower half of the detail page, fetched separately on purpose.
 *
 * The route hands the promise to React rather than awaiting it, so the shell
 * streams while this is still in flight. See docs/streaming.md.
 */
export async function getItemReviews(slug: string, request: Request): Promise<ItemReview[]> {
  const response = await gatewayFetchWithIdentity(
    request,
    \`/items/\${encodeURIComponent(slug)}/reviews\`,
  );
  // Reviews are an addition to the page, not the page: a missing or broken
  // response costs the section, not the product.
  if (!response.ok) {
    await releaseGatewayResponse(response);
    return [];
  }
  const payload = await readGatewayJson(response, GatewayContracts.items, INVALID);
  const reviews = requireGatewayPayload(
    GatewayContracts.items,
    payload,
    isReviewList,
    INVALID,
  );
  return reviews.reviews;
}

function isItem(value: unknown): value is Item {
  return (
    isRecord(value) &&
    isBoundedString(value.slug, 100) &&
    isBoundedString(value.name, 200) &&
    isBoundedString(value.blurb, 1_000) &&
    isBoundedString(value.category, 60) &&
    isBoundedString(value.provider, 120) &&
    isRate(value.interestRate) &&
    isMoney(value.minAmount) &&
    isMoney(value.maxAmount) &&
    isBoundedArray(value.terms, 20, isTerm) &&
    isRecord(value.seo) &&
    isBoundedString(value.seo.title, 200) &&
    isBoundedString(value.seo.description, 500)
  );
}

/**
 * Money and rates are checked for range, not just for type.
 *
 * A negative payment or a 900% rate is not a display bug — it is a number a
 * visitor may act on, and it must not reach the page even if the upstream is
 * confident about it.
 */
function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12;
}

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isTerm(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 480;
}

function isQuote(value: unknown): value is ItemQuote {
  return (
    isRecord(value) &&
    isMoney(value.amount) &&
    isTerm(value.term) &&
    isMoney(value.monthlyPayment) &&
    isMoney(value.totalPayment) &&
    isRate(value.annualCostRate)
  );
}

function isItemDetail(value: unknown): value is ItemDetail {
  return (
    isRecord(value) &&
    isItem(value.item) &&
    isQuote(value.quote) &&
    parseSeoInfo(value.seoInfo, config.siteUrl) !== null
  );
}

function isFacet(value: unknown): value is ItemFacet {
  return (
    isRecord(value) &&
    isBoundedString(value.value, 60) &&
    typeof value.count === "number" &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0
  );
}

function isReview(value: unknown): value is ItemReview {
  return (
    isRecord(value) &&
    isBoundedString(value.author, 120) &&
    typeof value.rating === "number" &&
    Number.isFinite(value.rating) &&
    value.rating >= 1 &&
    value.rating <= 5 &&
    isBoundedString(value.comment, 2_000)
  );
}

function isReviewList(value: unknown): value is { reviews: ItemReview[] } {
  return isRecord(value) && isBoundedArray(value.reviews, 50, isReview);
}

export function isItemPage(value: unknown): value is ItemPage {
  return (
    isRecord(value) &&
    isBoundedArray(value.items, 100, isItem) &&
    isCount(value.total) &&
    isCount(value.page) &&
    isCount(value.totalPages) &&
    isRecord(value.facets) &&
    isBoundedArray(value.facets.categories, 50, isFacet) &&
    isRecord(value.query) &&
    isBoundedString(value.query.category, 60) &&
    isBoundedString(value.query.sortBy, 60) &&
    // SEO text is the CMS's to write. Parsing it here means a route never has to
    // guess whether the upstream gave it a usable canonical or an empty string.
    parseSeoInfo(value.seoInfo, config.siteUrl) !== null
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
`;

const featuredItemsService = () => `import * as cache from "@originloom/core/cache";
import { logger } from "@originloom/core/logger";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";
import { productConfig } from "@server/product/config";

import { itemsQuery } from "~/lib/catalog-query";

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
      if (hit.state === "stale") scheduleRefresh(request);
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

  const snapshot = await waitForRequest(refresh(request, key), request.signal);
  return { ...snapshot, cacheStatus: "miss" };
}

function refresh(
  request: Request,
  key = cache.cacheKey(FEATURED_ITEMS_CACHE_POLICY),
): Promise<FeaturedItemsSnapshot> {
  if (refreshInFlight) return refreshInFlight;
  if (!key) return Promise.reject(new Error("Featured items cache policy must be shared"));

  const pending = listItems(itemsQuery({ perPage: productConfig.catalogPageSize }), request)
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

function scheduleRefresh(request: Request): void {
  void refresh(request).catch((error: unknown) => {
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

const liveMessageService = () => `import {
  gatewayFetchWithIdentity,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
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
export async function getLiveMessage(request: Request): Promise<string> {
  const response = await gatewayFetchWithIdentity(request, "/live/message");
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
import { mountCalculatorApi } from "@server/api/calculator";
import { mountEnquiryApi } from "@server/api/enquiries";
import { mountPublicItemsApi } from "@server/api/items";
import { mountLiveStreamApi } from "@server/api/live-stream";
import { mountReferralApi } from "@server/api/referrals";
import { mountSessionApi } from "@server/api/session";
import { mountWebhookApi } from "@server/api/webhooks";
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

  // Leaving the site for a provider records something and sets a cookie, so
  // it is a POST, not a link — see docs/referrals.md.
  mountReferralApi(app);

  // The tool page renders its first result from this same endpoint, so the
  // island refines a plan instead of computing a second one.
  mountCalculatorApi(app);

  // The provider writing back to us. Signed, time-bounded and idempotent —
  // see docs/webhooks.md before changing any of the three.
  mountWebhookApi(app);

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
import {
  generateMetaDataForPageWithSeoInfo,
  publicAbsoluteUrl,
} from "@originloom/shared/lib/metadata/generate";
import {
  breadcrumbJsonLd,
  compactJsonLd,
  type JsonLdObject,
} from "@originloom/shared/lib/metadata/jsonld";
import { getItem, getItemReviews, type ItemDetail, type ItemReview } from "@server/services/items";

import { ItemDetailPage } from "~/features/items/item-detail-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { quoteSearch } from "~/lib/quote-query";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = ItemDetail & { reviews: ItemReview[] };

export default defineRoute<Data>({
  path: "/items/:slug",
  // Reject unbounded / garbage slugs before any cache lookup or render.
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  // Slug *and* the normalized quote query fragment the cache: two visitors asking
  // the same product for the same amount and term are asking for the same page.
  // Nothing here is personal, which is exactly why it can be shared.
  cache: pageCache(PageCacheId.itemDetail),
  loader: async (ctx) => {
    const slug = ctx.params.slug ?? "";
    const detail = await getItem(slug, quoteSearch(ctx.url), ctx.request);
    // Terminal result, not a thrown error — an unknown slug is a 404, never cached.
    if (!detail) return notFound();

    // A second, slower call — and deliberately *not* streamed. This page is
    // shared-cached, and a cached response cannot be a partial one: the entry
    // has to be the finished document or it is not an entry. So the cost is
    // paid once per key per TTL, by whoever misses the cache, and every other
    // visitor gets both halves for free.
    //
    // When a page cannot be cached, the trade is the other way round and
    // streaming wins — see server/routes/live.tsx and docs/streaming.md.
    const reviews = await getItemReviews(slug, ctx.request);

    return { data: { ...detail, reviews } };
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const url = publicAbsoluteUrl(ctx, \`/items/\${data.item.slug}\`);
    // Title, description, OG image and the indexing flags are the CMS's, parsed
    // and normalized by the platform. Writing them in the route instead means
    // every copy change is a deploy — and the fields nobody remembers by hand
    // (og:image, imageAlt, modifiedTime) are simply never set.
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    return {
      ...metadata,
      // The canonical is the product's address without the quote query: the
      // amount is a view of one page, not a page of its own.
      canonical: url,
      openGraph: { ...metadata.openGraph, url },
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Ürünler", url: publicAbsoluteUrl(ctx, "/catalog") },
            { name: data.item.name, url },
          ],
          base,
        ),
        offerJsonLd(data, url),
        // Only claimed when there is something to claim: a rating summary with no
        // ratings behind it is the kind of structured data that earns a penalty.
        ...(data.reviews.length > 0 ? [aggregateRatingJsonLd(data, url)] : []),
      ]),
    };
  },
  pageMeta: (data, ctx) => defaultPageMeta(ctx, "item-detail", { category: data.item.category }),
  Component: ItemDetailPage,
});

function offerJsonLd(data: Data, url: string): JsonLdObject {
  return {
    "@type": "FinancialProduct",
    "@id": \`\${url}#product\`,
    name: data.item.name,
    description: data.item.blurb,
    url,
    provider: { "@type": "Organization", name: data.item.provider },
    interestRate: data.item.interestRate,
    annualPercentageRate: data.quote.annualCostRate,
    amount: { "@type": "MonetaryAmount", currency: "TRY", value: data.quote.amount },
  };
}

function aggregateRatingJsonLd(data: Data, url: string): JsonLdObject {
  const total = data.reviews.reduce((sum, review) => sum + review.rating, 0);
  return {
    "@type": "AggregateRating",
    itemReviewed: { "@id": \`\${url}#product\` },
    ratingValue: Number((total / data.reviews.length).toFixed(1)),
    reviewCount: data.reviews.length,
  };
}

`;

const itemDetailPage = () => `import { Link } from "@originloom/react/lib/link";
import { useRequestContext } from "@originloom/react/lib/request-context";
import type { ItemDetail, ItemReview } from "@server/services/items";

import { formatMoney, QUOTE_TERMS, quoteHref } from "~/lib/quote-query";

type Data = ItemDetail & { reviews: ItemReview[] };

const AMOUNT_STEPS = [50_000, 100_000, 250_000, 500_000];

export function ItemDetailPage({ data }: { data: Data }) {
  const { search } = useRequestContext();
  const current = new URLSearchParams(search);
  const { item, quote } = data;

  return (
    <div className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/catalog">
        ← Ürünlere dön
      </Link>

      <header className="space-y-1">
        <p className="text-sm text-slate-500">{item.provider}</p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{item.name}</h1>
        <p className="max-w-2xl text-slate-600">{item.blurb}</p>
      </header>

      {/* The quote is server-rendered from the URL, so it is shareable, indexable
          and cached — and it is here with JavaScript switched off. */}
      <section aria-labelledby="quote-heading" className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 id="quote-heading" className="text-xl font-semibold text-slate-900">
          Örnek ödeme planı
        </h2>

        <div className="flex flex-wrap gap-6">
          <nav aria-label="Tutar" className="flex flex-wrap items-center gap-2">
            {AMOUNT_STEPS.filter((amount) => amount >= item.minAmount && amount <= item.maxAmount).map(
              (amount) => (
                <Link
                  key={amount}
                  className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:border-slate-400 aria-[current=true]:border-slate-900 aria-[current=true]:bg-slate-900 aria-[current=true]:text-white"
                  href={quoteHref(item.slug, current, { amount: String(amount) })}
                  current={quote.amount === amount}
                >
                  {formatMoney(amount)}
                </Link>
              ),
            )}
          </nav>

          <nav aria-label="Vade" className="flex flex-wrap items-center gap-2">
            {QUOTE_TERMS.filter((term) => item.terms.includes(term)).map((term) => (
              <Link
                key={term}
                className="text-sm text-slate-600 underline-offset-4 hover:underline aria-[current=true]:font-semibold aria-[current=true]:text-slate-900"
                href={quoteHref(item.slug, current, { term: String(term) })}
                current={quote.term === term}
              >
                {term} ay
              </Link>
            ))}
          </nav>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500">Aylık taksit</dt>
            <dd className="text-lg font-semibold text-slate-900">
              {formatMoney(quote.monthlyPayment)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Toplam geri ödeme</dt>
            <dd className="text-lg font-semibold text-slate-900">
              {formatMoney(quote.totalPayment)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Yıllık maliyet oranı</dt>
            <dd className="text-lg font-semibold text-slate-900">%{quote.annualCostRate}</dd>
          </div>
        </dl>

        <p className="text-xs text-slate-500">
          Faiz oranı %{item.interestRate}. Rakamlar örnektir ve başvuru sonucuna göre değişebilir.
        </p>

        {/* The application itself happens at the provider. Leaving this site is a
            write, not a link: see server/api/referrals.ts and docs/referrals.md. */}
        <form method="post" action="/api/referrals">
          <input type="hidden" name="slug" value={item.slug} />
          <input type="hidden" name="returnTo" value={quoteHref(item.slug, current, {})} />
          <button
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            type="submit"
          >
            {item.provider} ile devam et
          </button>
        </form>
      </section>

      <section aria-labelledby="reviews-heading" className="space-y-3">
        <h2 id="reviews-heading" className="text-xl font-semibold text-slate-900">
          Değerlendirmeler
        </h2>
        {data.reviews.length === 0 ? (
          <p className="text-sm text-slate-500">Bu ürün için henüz değerlendirme yok.</p>
        ) : (
          <ul className="space-y-3">
            {data.reviews.map((review, index) => (
              <li key={\`\${review.author}-\${index}\`} className="rounded-lg border border-slate-200 p-4">
                <p className="font-medium text-slate-800">
                  {review.author} ·{" "}
                  <span aria-label={\`\${review.rating} / 5\`}>{"★".repeat(Math.round(review.rating))}</span>
                </p>
                <p className="text-sm text-slate-600">{review.comment}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-slate-500">
        Dinamik route (<code>/items/:slug</code>). Slug ve normalize edilmiş <code>?amount</code>/
        <code>?term</code> cache key&apos;e girer — teklif paylaşımlıdır, kişisel değildir. Tutar
        1.000&apos;e yuvarlanır: aksi halde her farklı rakam kendi cache girdisi olurdu.
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

const catalogRoute =
  () => `import { defineRoute, notFound, redirect } from "@originloom/react/lib/types";
import { neverCache } from "@originloom/shared/lib/cache-policy";
import { resolvePageParam } from "@originloom/shared/lib/content-values";
import {
  generatePaginatedMetadata,
  publicAbsoluteUrl,
} from "@originloom/shared/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd, itemListJsonLd } from "@originloom/shared/lib/metadata/jsonld";
import { observeCatalogView } from "@server/metrics/catalog";
import { productConfig } from "@server/product/config";
import { type ItemPage, listItems } from "@server/services/items";

import { CatalogPage } from "~/features/catalog/catalog-page";
import { pageCache, PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { catalogSearch } from "~/lib/catalog-query";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = ItemPage & { variant?: string };

export default defineRoute<Data>({
  path: "/catalog",
  // Only allowlisted, normalized query values change the HTML, so only they enter
  // the key. A URL that is going to 404 or redirect is not cached at all —
  // otherwise a single bad link fills the cache with copies of an error.
  cache: pageCache(PageCacheId.catalog, (ctx) =>
    resolvePageParam(ctx.url.searchParams.get("page")).kind === "valid"
      ? pageCachePolicy(PageCacheId.catalog, ctx)
      : neverCache(),
  ),
  loader: async (ctx) => {
    const page = resolvePageParam(ctx.url.searchParams.get("page"));
    // \`?page=abc\` is not page 1 — it is a URL that was never valid. Silently
    // clamping it would serve the catalog under infinitely many addresses.
    if (page.kind === "invalid") return notFound();
    // \`?page=1\` and \`?page=01\` are the catalog under a second name. One page,
    // one URL: send the visitor and the crawler to the canonical one.
    if (page.kind === "redirect") {
      const target = new URL(ctx.url);
      target.searchParams.delete("page");
      return redirect(\`\${target.pathname}\${target.search}\`, 308);
    }

    const data = await listItems(catalogSearch(ctx.url, productConfig.catalogPageSize), ctx.request);
    // A page past the end is empty, and an empty page that returns 200 is a soft
    // 404 — the one SEO failure that never shows up in logs.
    if (page.page > data.totalPages || data.page !== page.page) return notFound();

    observeCatalogView(page.page);
    // \`ctx.values\` is what server/middleware/experiments.ts published for this
    // request. Reading it here is what makes the bucket real — and what makes
    // \`cacheVary\` in that middleware mandatory rather than tidy: this page now
    // renders differently per bucket, so its cached HTML must too.
    // Absent — not \`undefined\` — when the experiment middleware is not
    // registered, so the page renders without an arm rather than pretending to
    // have one.
    return {
      data: { ...data, ...(ctx.values?.variant ? { variant: ctx.values.variant } : {}) },
    };
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    // Title, description and indexing flags come from the gateway; the route adds
    // only what it alone knows — which page of the sequence this is.
    const metadata = generatePaginatedMetadata(
      data.seoInfo,
      ctx,
      data.page,
      data.totalPages,
      "/catalog",
    );
    return {
      ...metadata,
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Katalog", url: metadata.canonical ?? "/catalog" },
          ],
          base,
        ),
        itemListJsonLd(
          "Katalog",
          data.items.map((item) => ({ name: item.name, url: \`/items/\${item.slug}\` })),
          base,
        ),
      ]),
    };
  },
  // The bucket and the campaign both belong in analytics; only one of them
  // belongs in the cache key.
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "catalog", {
      category: data.query.category,
      ...(data.variant ? { experiment: data.variant } : {}),
      ...(ctx.values?.campaign ? { campaign: ctx.values.campaign } : {}),
    }),
  Component: CatalogPage,
});

`;

const catalogPage = () => `import { Link } from "@originloom/react/lib/link";
import { useRequestContext } from "@originloom/react/lib/request-context";
import type { ItemPage } from "@server/services/items";

import { CATALOG_SORTS, catalogHref } from "~/lib/catalog-query";

type Props = { data: ItemPage & { variant?: string } };

/** The two arms server/middleware/experiments.ts buckets visitors into. */
const PROMO = {
  a: "Faiz oranlarını karşılaştırın.",
  b: "Taksitinizi saniyeler içinde hesaplayın.",
} as const;

const SORT_LABELS: Record<string, string> = {
  recommended: "Önerilen",
  "rate-asc": "En düşük faiz",
  "name-asc": "İsme göre",
  newest: "En yeni",
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "Tümü",
  konut: "Konut kredisi",
  ihtiyac: "İhtiyaç kredisi",
  tasit: "Taşıt kredisi",
};

/**
 * Filters are links, not a form.
 *
 * Every filtered view is a real URL: it can be shared, indexed, opened in a new
 * tab and — because the query is allowlisted and normalized — served from the
 * shared HTML cache. A \`fetch\`-and-replace filter is faster to write and gives
 * up all four.
 */
export function CatalogPage({ data }: Props) {
  const { search } = useRequestContext();
  const current = new URLSearchParams(search);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Krediler</h1>

      {/* The experiment arm, rendered on the server inside cached HTML — which
          is exactly why the middleware that chose it varies the cache key.
          Absent until that middleware is registered. See docs/middleware.md. */}
      {data.variant ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {PROMO[data.variant === "b" ? "b" : "a"]}{" "}
          <span className="text-xs text-slate-500">(deney kovası: {data.variant})</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-6">
        <nav aria-label="Kategori" className="flex flex-wrap items-center gap-2">
          {data.facets.categories.map((facet) => (
            <Link
              key={facet.value}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:border-slate-400 aria-[current=true]:border-slate-900 aria-[current=true]:bg-slate-900 aria-[current=true]:text-white"
              href={catalogHref(current, { category: facet.value })}
              current={data.query.category === facet.value}
            >
              {CATEGORY_LABELS[facet.value] ?? facet.value} ({facet.count})
            </Link>
          ))}
        </nav>

        <nav aria-label="Sıralama" className="flex flex-wrap items-center gap-2">
          {CATALOG_SORTS.map((sort) => (
            <Link
              key={sort}
              className="text-sm text-slate-600 underline-offset-4 hover:underline aria-[current=true]:font-semibold aria-[current=true]:text-slate-900"
              href={catalogHref(current, { sortBy: sort })}
              current={data.query.sortBy === sort}
            >
              {SORT_LABELS[sort] ?? sort}
            </Link>
          ))}
        </nav>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-slate-600">
          Bu filtreyle eşleşen kayıt yok. <Link href="/catalog">Filtreleri temizle</Link>.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.items.map((item) => (
            <li key={item.slug} className="py-3">
              <Link className="font-medium text-slate-800 hover:underline" href={\`/items/\${item.slug}\`}>
                {item.name}
              </Link>
              <p className="text-sm text-slate-500">{item.blurb}</p>
              <p className="text-xs text-slate-500">
                {item.provider} · faiz %{item.interestRate} · {item.terms.at(-1)} aya kadar
              </p>
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Sayfalama" className="flex items-center gap-4 text-sm">
        {data.page > 1 ? (
          <Link className="text-slate-700 hover:underline" href={catalogHref(current, { page: String(data.page - 1) })}>
            ← Önceki
          </Link>
        ) : (
          <span className="text-slate-500">← Önceki</span>
        )}
        <span className="text-slate-500">
          Sayfa {data.page} / {data.totalPages} · {data.total} kayıt
        </span>
        {data.page < data.totalPages ? (
          <Link className="text-slate-700 hover:underline" href={catalogHref(current, { page: String(data.page + 1) })}>
            Sonraki →
          </Link>
        ) : (
          <span className="text-slate-500">Sonraki →</span>
        )}
      </nav>

      <p className="text-sm text-slate-500">
        Filtreler ve <code>?page</code> allowlist ile cache key&apos;e girer; tracking param&apos;ları
        girmez. Bilinmeyen bir değer 404 değil, varsayılandır — <code>?page=abc</code> hariç, çünkü o
        hiç var olmamış bir adres.
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
      slowMessage: getLiveMessage(ctx.request),
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

const sitemapService = () => `import {
  gatewayFetch,
  gatewayFetchWithIdentity,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

const MAX_SITEMAP_ENTRIES = 50_000;
const MAX_PATH_LENGTH = 2_048;
const INVALID = "Sitemap gateway returned an invalid payload";

export type SitemapEntry = { path: string; lastModified?: string };

/**
 * Which URLs exist, asked rather than derived.
 *
 * Deriving the sitemap from the first page of the catalogue works until the
 * catalogue is bigger than one page — and then it silently ships a sitemap that
 * omits most of the site. The gateway is the only thing that knows the whole
 * set, so it is the thing that answers.
 */
export async function fetchSitemapEntries(request?: Request): Promise<SitemapEntry[]> {
  const response = request
    ? await gatewayFetchWithIdentity(request, "/seo/sitemap")
    : await gatewayFetch("/seo/sitemap");
  await requireGatewayOk(response, "Sitemap gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.sitemap, INVALID);
  const result = requireGatewayPayload(GatewayContracts.sitemap, payload, isSitemapPayload, INVALID);
  // Last one wins on a duplicate path: a sitemap that lists the same URL twice is
  // a sitemap a crawler distrusts.
  return [...new Map(result.entries.map((entry) => [entry.path, entry])).values()];
}

function isSitemapPayload(value: unknown): value is { entries: SitemapEntry[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.length > 0 &&
    value.entries.length <= MAX_SITEMAP_ENTRIES &&
    value.entries.every(isSitemapEntry)
  );
}

function isSitemapEntry(value: unknown): value is SitemapEntry {
  if (!isRecord(value) || !isPublicPath(value.path)) return false;
  return value.lastModified === undefined || isIsoDate(value.lastModified);
}

/**
 * A sitemap entry is a public path on this site and nothing else.
 *
 * Rejecting \`//host/path\`, a query, a fragment or a control character here is
 * what stops an upstream mistake from publishing someone else's URLs under this
 * domain's authority.
 */
function isPublicPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.includes("\\\\") &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
`;

const sitemapServiceTest = () => `import { fetchSitemapEntries } from "@server/services/sitemap";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const request = new Request("http://app.local/sitemap.xml");

function upstream(entries: unknown[]) {
  mocks.gatewayFetchWithIdentity.mockImplementation(async () => Response.json({ entries }));
}

describe("the sitemap source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks the gateway which URLs exist", async () => {
    upstream([{ path: "/" }, { path: "/catalog" }, { path: "/items/alpha" }]);

    await expect(fetchSitemapEntries(request)).resolves.toEqual([
      { path: "/" },
      { path: "/catalog" },
      { path: "/items/alpha" },
    ]);
  });

  it("lists a duplicated path once", async () => {
    upstream([{ path: "/catalog" }, { path: "/catalog", lastModified: "2026-01-01T00:00:00.000Z" }]);

    const entries = await fetchSitemapEntries(request);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.lastModified).toBe("2026-01-01T00:00:00.000Z");
  });

  it.each([
    ["//evil.example/takeover", "a protocol-relative URL is somebody else's host"],
    ["/search?q=x", "a query makes it a different URL than the one indexed"],
    ["/page#section", "a fragment is not a page"],
    ["not-a-path", "a relative string is not a public path"],
  ])("refuses %s", async (path) => {
    upstream([{ path }]);

    // An upstream mistake must not be able to publish arbitrary URLs under this
    // domain's authority.
    await expect(fetchSitemapEntries(request)).rejects.toThrow(/invalid payload/i);
  });
});
`;

const routeDomainsService =
  () => `import { gatewayFetch, gatewayFetchWithIdentity, requireGatewayOk } from "@originloom/core/adapters/gateway";
import * as cache from "@originloom/core/cache";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";

import { GatewayContracts } from "./gateway-contracts";

const ROUTE_DOMAINS_CACHE_KEY = "route-domains";
const MAX_DOMAIN_VALUES = 500;
const INVALID = "Route domains gateway returned an invalid payload";

export type RouteDomains = {
  /** The category slugs that exist, as the gateway currently defines them. */
  categories: string[];
};

/**
 * Which values a route param may take, when the answer is not in this codebase.
 *
 * \`isBoundedRouteSlug\` answers "is this the right shape" — cheap, offline, and
 * it lets \`/catalog/anything-shaped-like-a-slug\` through. This answers "does it
 * exist", which only the gateway knows, and which changes without a deploy.
 *
 * The snapshot goes through the shared cache so the check costs one upstream
 * call per TTL for the whole fleet rather than one per request. That matters
 * because validateParams runs *before* the page cache is consulted: it is on the
 * path of every request to the route, hit or miss.
 */
export async function fetchRouteDomains(request?: Request): Promise<RouteDomains> {
  const policy = { kind: "shared" as const, ttl: 300, swr: 0, key: [ROUTE_DOMAINS_CACHE_KEY] };
  const key = cache.cacheKey(policy);

  if (key) {
    const hit = await cache.read(key);
    if (hit) {
      try {
        const cached: unknown = JSON.parse(hit.body);
        if (isRouteDomains(cached)) return normalize(cached);
      } catch {
        // A corrupt or older snapshot is not worth repairing: drop it and refetch.
      }
      await cache.deleteKey(key);
    }
  }

  // A refresh triggered outside a request — a warm-up, a test — has no identity
  // to carry, and inventing one would be worse than sending none.
  const response = request
    ? await gatewayFetchWithIdentity(request, "/routing/domains")
    : await gatewayFetch("/routing/domains");
  await requireGatewayOk(response, "Route domains gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.routeDomains, INVALID);
  const domains = normalize(
    requireGatewayPayload(GatewayContracts.routeDomains, payload, isRouteDomains, INVALID),
  );
  if (key) await cache.write(key, JSON.stringify(domains), policy);
  return domains;
}

export async function isKnownCategory(
  category: string | undefined,
  request?: Request,
): Promise<boolean> {
  // Shape first, and only then the upstream: a 4 KB param is rejected without
  // ever reaching the cache or the gateway.
  if (!category || !isBoundedRouteSlug(category)) return false;
  return (await fetchRouteDomains(request)).categories.includes(category);
}

function isRouteDomains(value: unknown): value is RouteDomains {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return isSlugList((value as Record<string, unknown>).categories);
}

function isSlugList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_DOMAIN_VALUES &&
    value.every((item) => typeof item === "string" && isBoundedRouteSlug(item))
  );
}

/** Sorted and de-duplicated, so the same upstream answer is the same cache body. */
function normalize(domains: RouteDomains): RouteDomains {
  return { categories: [...new Set(domains.categories)].sort() };
}
`;

const catalogCategoryRoute =
  () => `import { defineRoute, redirect } from "@originloom/react/lib/types";
import { isKnownCategory } from "@server/services/route-domains";

/**
 * A path-shaped alias for a query-shaped page.
 *
 * \`/catalog/tools\` reads better in a link and a campaign than
 * \`/catalog?category=tools\`, but two URLs for one page is a duplicate — so this
 * one is not a page at all: it validates and redirects, permanently.
 *
 * The point of the example is \`validateParams\`. It runs before the page cache is
 * consulted, so an unknown category never allocates a cache entry, and a
 * thousand requests for \`/catalog/does-not-exist\` cost one upstream lookup per
 * TTL rather than a thousand renders.
 */
export default defineRoute({
  path: "/catalog/:category",
  minimalChrome: true,

  // Not a shape check: the answer lives in the gateway and changes without a
  // deploy. Returning false here is a 404 before anything else runs.
  validateParams: (ctx) => isKnownCategory(ctx.params.category, ctx.request),

  loader: async (ctx) =>
    redirect(\`/catalog?category=\${encodeURIComponent(ctx.params.category ?? "")}\`, 301),

  // Never reached: the loader always terminates with a redirect. A route still
  // has to name a component, so this one says so out loud rather than pretending.
  Component: () => <p>Yönlendiriliyorsunuz…</p>,
});
`;

const routeDomainsTest =
  () => `import { fetchRouteDomains, isKnownCategory } from "@server/services/route-domains";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  gatewayFetchWithIdentity: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  deleteKey: vi.fn(),
}));

vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetch: mocks.gatewayFetch,
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));
vi.mock("@originloom/core/cache", () => ({
  cacheKey: (policy: { key: string[] }) => policy.key.join("\\0"),
  read: mocks.read,
  write: mocks.write,
  deleteKey: mocks.deleteKey,
}));

const domains = { categories: ["tools", "materials"] };
const request = new Request("http://app.local/catalog/tools");

describe("route params validated against the gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(null);
    mocks.write.mockResolvedValue(true);
    mocks.deleteKey.mockResolvedValue(true);
    // A fresh Response per call: a body can only be read once, and reusing one
    // would fail for a reason that has nothing to do with the code under test.
    mocks.gatewayFetchWithIdentity.mockImplementation(async () => Response.json(domains));
    mocks.gatewayFetch.mockImplementation(async () => Response.json(domains));
  });

  it("accepts a value the gateway knows and rejects one it does not", async () => {
    await expect(isKnownCategory("tools", request)).resolves.toBe(true);
    await expect(isKnownCategory("nonsense", request)).resolves.toBe(false);
  });

  it("rejects a malformed param without asking the gateway at all", async () => {
    await expect(isKnownCategory("../../etc/passwd", request)).resolves.toBe(false);
    await expect(isKnownCategory("A".repeat(500), request)).resolves.toBe(false);

    // Shape is checked offline, so a flood of garbage params cannot be turned
    // into a flood of upstream calls.
    expect(mocks.gatewayFetchWithIdentity).not.toHaveBeenCalled();
  });

  it("serves the snapshot from the shared cache instead of calling again", async () => {
    mocks.read.mockResolvedValue({ body: JSON.stringify(domains), state: "fresh" });

    await fetchRouteDomains(request);

    // validateParams runs before the page cache, on hits as well as misses. One
    // gateway call per TTL for the fleet, not one per request.
    expect(mocks.gatewayFetchWithIdentity).not.toHaveBeenCalled();
  });

  it("drops a corrupt snapshot rather than trusting it", async () => {
    mocks.read.mockResolvedValue({ body: "{not json", state: "fresh" });

    await expect(fetchRouteDomains(request)).resolves.toEqual({
      categories: ["materials", "tools"],
    });
    expect(mocks.deleteKey).toHaveBeenCalledWith("route-domains");
  });

  it("refuses an upstream answer that is not a list of slugs", async () => {
    mocks.gatewayFetchWithIdentity.mockImplementation(async () =>
      Response.json({ categories: ["Not A Slug"] }),
    );

    // Letting this through would put unvalidated upstream data in the position
    // of deciding which URLs exist.
    await expect(fetchRouteDomains(request)).rejects.toThrow(/invalid payload/i);
  });
});
`;

const guidesService = () => `import {
  gatewayFetchWithIdentity,
  releaseGatewayResponse,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import { config } from "@originloom/core/config";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { parseSeoInfo } from "@originloom/shared/lib/metadata/schema";
import type { SeoInfo } from "@originloom/shared/lib/metadata/types";
import { isBoundedArray, isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

const INVALID = "Guides gateway returned an invalid payload";

export type GuideSection = { heading: string; body: string };
export type GuideQuestion = { question: string; answer: string };

export type Guide = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  sections: GuideSection[];
  faq: GuideQuestion[];
};

export type GuideDetail = { guide: Guide; seoInfo: SeoInfo };
export type GuideList = { items: Pick<Guide, "slug" | "title" | "excerpt" | "category">[] };

export async function listGuides(request: Request): Promise<GuideList> {
  const response = await gatewayFetchWithIdentity(request, "/guides");
  await requireGatewayOk(response, "Guides gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.guides, INVALID);
  return requireGatewayPayload(GatewayContracts.guides, payload, isGuideList, INVALID);
}

export async function getGuide(slug: string, request: Request): Promise<GuideDetail | null> {
  const response = await gatewayFetchWithIdentity(request, \`/guides/\${encodeURIComponent(slug)}\`);
  if (response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  await requireGatewayOk(response, "Guides gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.guides, INVALID);
  return requireGatewayPayload(GatewayContracts.guides, payload, isGuideDetail, INVALID);
}

function isGuideList(value: unknown): value is GuideList {
  return (
    isRecord(value) &&
    isBoundedArray(
      value.items,
      100,
      (item): item is GuideList["items"][number] =>
        isRecord(item) &&
        isBoundedString(item.slug, 100) &&
        isBoundedString(item.title, 300) &&
        isBoundedString(item.excerpt, 2_000) &&
        isBoundedString(item.category, 60),
    )
  );
}

function isGuideDetail(value: unknown): value is GuideDetail {
  return (
    isRecord(value) &&
    isGuide(value.guide) &&
    parseSeoInfo(value.seoInfo, config.siteUrl) !== null
  );
}

function isGuide(value: unknown): value is Guide {
  return (
    isRecord(value) &&
    isBoundedString(value.slug, 100) &&
    isBoundedString(value.title, 300) &&
    isBoundedString(value.excerpt, 2_000) &&
    isBoundedString(value.category, 60) &&
    isBoundedString(value.author, 160) &&
    isBoundedArray(value.tags, 30, (tag): tag is string => isBoundedString(tag, 60)) &&
    // Dates go into \`datePublished\`/\`dateModified\`. A malformed one is a broken
    // claim in the structured data, not just a formatting slip.
    isIsoDate(value.publishedAt) &&
    isIsoDate(value.updatedAt) &&
    isBoundedArray(
      value.sections,
      100,
      (section): section is GuideSection =>
        isRecord(section) &&
        isBoundedString(section.heading, 300) &&
        isBoundedString(section.body, 20_000),
    ) &&
    isBoundedArray(
      value.faq,
      50,
      (item): item is GuideQuestion =>
        isRecord(item) &&
        isBoundedString(item.question, 500) &&
        isBoundedString(item.answer, 8_000),
    )
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
`;

const articleJsonLdLib =
  () => `import type { JsonLdObject } from "@originloom/shared/lib/metadata/jsonld";
import type { Guide } from "@server/services/guides";

/**
 * The two node types an editorial page earns and a product page does not.
 *
 * \`Article\` is what makes a guide eligible for the article treatments in search
 * results; \`FAQPage\` is what turns its questions into expandable answers there.
 * Both are claims about the page, so both are built from the loader's validated
 * data rather than from anything assembled by hand.
 */
export function articleJsonLd(guide: Guide, canonical: string, siteUrl: string): JsonLdObject {
  const base = siteUrl.replace(/\\/$/, "");
  return {
    "@type": "Article",
    "@id": \`\${canonical}#article\`,
    mainEntityOfPage: { "@id": \`\${canonical}#webpage\` },
    headline: guide.title,
    description: guide.excerpt,
    datePublished: guide.publishedAt,
    dateModified: guide.updatedAt,
    author: { "@type": "Person", name: guide.author },
    publisher: { "@id": \`\${base}/#organization\` },
    articleSection: guide.category,
    keywords: guide.tags,
    inLanguage: "tr-TR",
    isAccessibleForFree: true,
  };
}

/**
 * Null when there are no questions.
 *
 * An empty \`FAQPage\` is a claim that the page answers questions it does not, and
 * \`compactJsonLd\` drops the null rather than emitting a hollow node.
 */
export function faqJsonLd(items: readonly { question: string; answer: string }[]): JsonLdObject | null {
  if (items.length === 0) return null;
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
`;

const guidesRoute = () => `import { defineRoute } from "@originloom/react/lib/types";
import { publicAbsoluteUrl } from "@originloom/shared/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd, itemListJsonLd } from "@originloom/shared/lib/metadata/jsonld";
import { type GuideList, listGuides } from "@server/services/guides";

import { GuidesPage } from "~/features/guides/guides-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<GuideList>({
  path: "/guides",
  cache: pageCache(PageCacheId.guides),
  loader: async (ctx) => ({ data: await listGuides(ctx.request) }),
  generateMetadata: (data, ctx) => ({
    title: "Rehberler",
    description: "Kredi ürünleri hakkında rehberler ve sık sorulan sorular.",
    canonical: publicAbsoluteUrl(ctx, "/guides"),
    structuredData: compactJsonLd([
      breadcrumbJsonLd(
        [
          { name: "Ana sayfa", url: publicAbsoluteUrl(ctx, "/") },
          { name: "Rehberler", url: publicAbsoluteUrl(ctx, "/guides") },
        ],
        ctx.siteUrl ?? ctx.url.origin,
      ),
      itemListJsonLd(
        "Rehberler",
        data.items.map((guide) => ({ name: guide.title, url: \`/guides/\${guide.slug}\` })),
        ctx.siteUrl ?? ctx.url.origin,
      ),
    ]),
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "guides"),
  Component: GuidesPage,
});
`;

const guideDetailRoute = () => `import { defineRoute, notFound } from "@originloom/react/lib/types";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import {
  generateMetaDataForPageWithSeoInfo,
  publicAbsoluteUrl,
} from "@originloom/shared/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/shared/lib/metadata/jsonld";
import { getGuide, type GuideDetail } from "@server/services/guides";

import { GuidePage } from "~/features/guides/guide-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { articleJsonLd, faqJsonLd } from "~/lib/metadata/jsonld-article";
import { defaultPageMeta } from "~/lib/shell-data";

/**
 * An editorial page.
 *
 * The difference from a product page is what it can claim: \`Article\` makes it
 * eligible for the article treatments in search results, and \`FAQPage\` turns its
 * questions into expandable answers there. Both are claims, so both come from
 * validated loader data — including the dates, which is why the service parses
 * them rather than passing strings through.
 */
export default defineRoute<GuideDetail>({
  path: "/guides/:slug",
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: pageCache(PageCacheId.guideDetail),
  loader: async (ctx) => {
    const detail = await getGuide(ctx.params.slug ?? "", ctx.request);
    return detail ? { data: detail } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const url = publicAbsoluteUrl(ctx, \`/guides/\${data.guide.slug}\`);
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    return {
      ...metadata,
      canonical: url,
      openGraph: { ...metadata.openGraph, url },
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Rehberler", url: publicAbsoluteUrl(ctx, "/guides") },
            { name: data.guide.title, url },
          ],
          base,
        ),
        articleJsonLd(data.guide, url, base),
        faqJsonLd(data.guide.faq),
      ]),
    };
  },
  pageMeta: (data, ctx) => defaultPageMeta(ctx, "guide-detail", { category: data.guide.category }),
  Component: GuidePage,
});
`;

const guidesPage = () => `import { Link } from "@originloom/react/lib/link";
import type { GuideList } from "@server/services/guides";

export function GuidesPage({ data }: { data: GuideList }) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Rehberler</h1>
        <p className="max-w-2xl text-slate-600">
          Ürün sayfaları teklif verir, rehberler açıklar. İkisinin yapısal verisi de farklıdır —
          <code>Article</code> ve <code>FAQPage</code> yalnız buraya aittir.
        </p>
      </header>
      <ul className="divide-y divide-slate-100">
        {data.items.map((guide) => (
          <li key={guide.slug} className="py-3">
            <Link className="font-medium text-slate-800 hover:underline" href={\`/guides/\${guide.slug}\`}>
              {guide.title}
            </Link>
            <p className="text-sm text-slate-500">{guide.excerpt}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
`;

const guidePage = () => `import { Link } from "@originloom/react/lib/link";
import type { GuideDetail } from "@server/services/guides";

export function GuidePage({ data }: { data: GuideDetail }) {
  const { guide } = data;
  return (
    <article className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/guides">
        ← Rehberlere dön
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{guide.title}</h1>
        <p className="text-sm text-slate-500">
          {guide.author} ·{" "}
          {/* The machine-readable date is the one in the structured data; this is
              the human one, and they come from the same field. */}
          <time dateTime={guide.publishedAt}>
            {new Date(guide.publishedAt).toLocaleDateString("tr-TR")}
          </time>
        </p>
        <p className="max-w-2xl text-slate-600">{guide.excerpt}</p>
      </header>

      {guide.sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">{section.heading}</h2>
          <p className="max-w-2xl text-slate-600">{section.body}</p>
        </section>
      ))}

      {guide.faq.length > 0 ? (
        <section aria-labelledby="faq-heading" className="space-y-3">
          <h2 id="faq-heading" className="text-xl font-semibold text-slate-900">
            Sık sorulan sorular
          </h2>
          {/* The visible answers and the FAQPage nodes are the same content. A
              structured-data block describing text that is not on the page is the
              kind of mismatch that gets a site's rich results removed. */}
          <dl className="space-y-3">
            {guide.faq.map((item) => (
              <div key={item.question} className="rounded-lg border border-slate-200 p-4">
                <dt className="font-medium text-slate-800">{item.question}</dt>
                <dd className="text-sm text-slate-600">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  );
}
`;

const guidesTest = () => `import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { installProductRuntime } from "@server/product/runtime";
import { routes } from "@server/routes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const guide = {
  slug: "konut-kredisi-rehberi",
  title: "Konut kredisi rehberi",
  excerpt: "Başvurudan önce bilmeniz gerekenler.",
  category: "konut",
  author: "Ada Lovelace",
  tags: ["konut", "kredi"],
  publishedAt: "2026-01-10T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  sections: [{ heading: "Faiz nasıl hesaplanır?", body: "Anüite yöntemiyle." }],
  faq: [{ question: "Peşinat şart mı?", answer: "Genellikle %20." }],
};
const seoInfo = { title: "Konut kredisi rehberi", friendlyUrl: "/guides/konut-kredisi-rehberi" };

function structuredData(html: string): Record<string, unknown>[] {
  const block = /<script type="application\\/ld\\+json"[^>]*>(.*?)<\\/script>/s.exec(html);
  if (!block) return [];
  const parsed = JSON.parse(block[1] ?? "{}") as { "@graph"?: Record<string, unknown>[] };
  return parsed["@graph"] ?? [];
}

async function render(path: string): Promise<string> {
  const app = createApp({
    assets: { js: "/assets/entry.client.js", css: [], fonts: [] },
    routes,
    readinessCheck: async () => true,
  });
  return (await app.request(\`http://app.local\${path}\`)).text();
}

describe("an editorial page", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.gatewayFetchWithIdentity.mockImplementation(async () => Response.json({ guide, seoInfo }));
    installProductRuntime();
    await closeCache();
    await initCache();
  });
  afterEach(async () => {
    await closeCache();
  });

  it("claims Article and FAQPage, which a product page must not", async () => {
    const types = structuredData(await render("/guides/konut-kredisi-rehberi")).map(
      (node) => node["@type"],
    );

    expect(types).toContain("Article");
    expect(types).toContain("FAQPage");
    expect(types).toContain("BreadcrumbList");
  });

  it("puts the same questions in the markup as in the structured data", async () => {
    const html = await render("/guides/konut-kredisi-rehberi");

    // Structured data describing text that is not on the page is the mismatch
    // that gets a site's rich results removed.
    expect(html).toContain("Peşinat şart mı?");
    const faq = structuredData(html).find((node) => node["@type"] === "FAQPage");
    expect(JSON.stringify(faq)).toContain("Peşinat şart mı?");
  });

  it("makes no FAQ claim when the guide has no questions", async () => {
    mocks.gatewayFetchWithIdentity.mockImplementation(async () =>
      Response.json({ guide: { ...guide, faq: [] }, seoInfo }),
    );

    const types = structuredData(await render("/guides/konut-kredisi-rehberi")).map(
      (node) => node["@type"],
    );

    // An empty FAQPage is a claim that the page answers questions it does not.
    expect(types).not.toContain("FAQPage");
    expect(types).toContain("Article");
  });

  it("refuses a guide whose dates the upstream got wrong", async () => {
    mocks.gatewayFetchWithIdentity.mockImplementation(async () =>
      Response.json({ guide: { ...guide, publishedAt: "yakında" }, seoInfo }),
    );

    // datePublished is a claim in the structured data, not a formatting detail.
    const response = await render("/guides/konut-kredisi-rehberi");
    expect(response).not.toContain("Konut kredisi rehberi");
  });
});
`;

const calculatorService =
  () => `import { gatewayFetchWithIdentity, requireGatewayOk } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedArray, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

const INVALID = "Calculator gateway returned an invalid payload";

export type PaymentRow = { month: number; payment: number; interest: number; principal: number };
export type PaymentPlan = {
  amount: number;
  term: number;
  interestRate: number;
  monthlyPayment: number;
  totalPayment: number;
  rows: PaymentRow[];
};

/**
 * The payment plan, computed upstream.
 *
 * The same call backs the server render and the island: one implementation of
 * the arithmetic, one place where a rounding rule changes. A calculator that
 * does its own maths in the browser is a second source of truth for a number
 * people make decisions with.
 */
export async function getPaymentPlan(
  search: URLSearchParams,
  request: Request,
): Promise<PaymentPlan> {
  const response = await gatewayFetchWithIdentity(request, \`/calculators/loan?\${search}\`);
  await requireGatewayOk(response, "Calculator gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.calculator, INVALID);
  return requireGatewayPayload(GatewayContracts.calculator, payload, isPaymentPlan, INVALID);
}

function isPaymentPlan(value: unknown): value is PaymentPlan {
  return (
    isRecord(value) &&
    isNumber(value.amount) &&
    isNumber(value.term) &&
    isNumber(value.interestRate) &&
    isNumber(value.monthlyPayment) &&
    isNumber(value.totalPayment) &&
    isBoundedArray(value.rows, 480, isRow)
  );
}

function isRow(value: unknown): value is PaymentRow {
  return (
    isRecord(value) &&
    isNumber(value.month) &&
    isNumber(value.payment) &&
    isNumber(value.interest) &&
    isNumber(value.principal)
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
`;

const calculatorApi =
  () => `import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { getPaymentPlan } from "@server/services/calculator";
import type { Hono } from "hono";

import { calculatorSearch } from "~/lib/calculator-query";

/**
 * The same answer the page renders, as JSON.
 *
 * The island calls this rather than recomputing anything, so the numbers on the
 * screen after an interaction are the numbers the server would have produced.
 */
const CALCULATOR_POLICY: PublicApiPolicy = {
  name: "calculator",
  windowMs: 60_000,
  globalLimit: 1_200,
  ipLimit: 120,
  requireSameOriginMutation: true,
};

export function mountCalculatorApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/calculator", async (c) => {
    const request = contextRequest(c);
    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", CALCULATOR_POLICY);
    if (denied) return denied;

    // Normalized with the same contract the page uses, so a URL that renders one
    // plan cannot fetch a different one.
    const plan = await getPaymentPlan(calculatorSearch(new URL(request.url)), request);
    return c.json(plan, 200, {
      // Public, identical for everyone with the same inputs, and normalized to a
      // small set of them — so an intermediary may hold it.
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    });
  });
}
`;

const calculatorQueryLib = () => `/**
 * The calculator's query contract, shared by the page, the cache key and the API.
 *
 * A third reader here, and the same rule: one definition. If the island
 * normalized differently from the route, the plan you see after moving a slider
 * would not be the plan the URL renders when you share it.
 */
export const CALCULATOR_QUERY = ["amount", "term", "rate"] as const;

export const CALCULATOR_TERMS = [12, 24, 36, 48, 60] as const;
export const DEFAULT_CALCULATOR = { amount: 100_000, term: 36, rate: 3.1 };

const MIN_AMOUNT = 10_000;
const MAX_AMOUNT = 5_000_000;
const AMOUNT_STEP = 1_000;
const TERMS = new Set<number>(CALCULATOR_TERMS);

export const calculatorNormalizers: Record<string, (raw: string | null) => string> = {
  amount: (raw) => {
    if (raw === null || raw.trim() === "") return String(DEFAULT_CALCULATOR.amount);
    const value = Number(raw);
    if (!Number.isFinite(value)) return String(DEFAULT_CALCULATOR.amount);
    const clamped = Math.min(MAX_AMOUNT, Math.max(MIN_AMOUNT, value));
    return String(Math.round(clamped / AMOUNT_STEP) * AMOUNT_STEP);
  },
  term: (raw) => {
    if (raw === null || raw.trim() === "") return String(DEFAULT_CALCULATOR.term);
    const value = Number(raw);
    return String(TERMS.has(value) ? value : DEFAULT_CALCULATOR.term);
  },
  rate: (raw) => {
    if (raw === null || raw.trim() === "") return String(DEFAULT_CALCULATOR.rate);
    const value = Number(raw);
    if (!Number.isFinite(value)) return String(DEFAULT_CALCULATOR.rate);
    // Two decimals: a rate is quoted that way, and every extra digit would be
    // another cache entry of the same table.
    return String(Math.min(10, Math.max(0.1, Math.round(value * 100) / 100)));
  },
};

export function calculatorSearch(url: URL): URLSearchParams {
  const search = new URLSearchParams();
  for (const name of CALCULATOR_QUERY) {
    search.set(name, calculatorNormalizers[name]!(url.searchParams.get(name)));
  }
  return search;
}
`;

const calculatorRoute = () => `import { Island } from "@originloom/react/lib/island";
import { defineRoute } from "@originloom/react/lib/types";
import { publicAbsoluteUrl } from "@originloom/shared/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/shared/lib/metadata/jsonld";
import { getPaymentPlan, type PaymentPlan } from "@server/services/calculator";

import { CalculatorPage } from "~/features/calculator/calculator-page";
import LoanCalculator from "~/islands/loan-calculator";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { calculatorSearch } from "~/lib/calculator-query";
import { defaultPageMeta } from "~/lib/shell-data";

/**
 * A tool, and a page.
 *
 * The first render is the server's: the plan is in the HTML, so the page works
 * with no JavaScript, is shareable at a given set of inputs, and is cached like
 * any other page. The island then refines it in place without a round trip
 * through the document.
 */
export default defineRoute<PaymentPlan>({
  path: "/calculator",
  cache: pageCache(PageCacheId.calculator),
  loader: async (ctx) => ({ data: await getPaymentPlan(calculatorSearch(ctx.url), ctx.request) }),
  generateMetadata: (data, ctx) => ({
    title: "Kredi hesaplama",
    description: \`\${data.term} ay vadeli kredi için örnek ödeme planı.\`,
    canonical: publicAbsoluteUrl(ctx, "/calculator"),
    structuredData: compactJsonLd([
      breadcrumbJsonLd(
        [
          { name: "Ana sayfa", url: publicAbsoluteUrl(ctx, "/") },
          { name: "Kredi hesaplama", url: publicAbsoluteUrl(ctx, "/calculator") },
        ],
        ctx.siteUrl ?? ctx.url.origin,
      ),
    ]),
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "calculator"),
  Component: ({ data }) => (
    <CalculatorPage>
      {/* \`hydrate\` means the server renders this and the client wakes it up, so
          the children must be the island itself. Hand-writing a second copy of
          the markup here is how a hydration mismatch starts. */}
      <Island name="loan-calculator" mode="hydrate" props={{ initial: data }}>
        <LoanCalculator initial={data} />
      </Island>
    </CalculatorPage>
  ),
});
`;

const calculatorPage = () => `import type { ReactNode } from "react";

export function CalculatorPage({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Kredi hesaplama</h1>
        <p className="max-w-2xl text-slate-600">
          İlk sonuç sunucuda üretilir: sayfa JavaScript kapalıyken de çalışır, verdiğiniz
          değerlerle paylaşılabilir ve cache&apos;lenir. Island aynı ucu çağırarak yerinde günceller
          — aritmetiği tarayıcıda tekrar etmez.
        </p>
      </header>
      {children}
    </div>
  );
}
`;

const calculatorIsland = () => `import { useState } from "react";

import {
  CALCULATOR_TERMS,
  calculatorNormalizers,
  DEFAULT_CALCULATOR,
} from "~/lib/calculator-query";
import { formatMoney } from "~/lib/quote-query";

type PaymentRow = { month: number; payment: number; interest: number; principal: number };
type PaymentPlan = {
  amount: number;
  term: number;
  interestRate: number;
  monthlyPayment: number;
  totalPayment: number;
  rows: PaymentRow[];
};

/**
 * The server already rendered a plan; this refines it.
 *
 * \`initial\` is that plan, so there is no loading state on first paint and no
 * layout shift when the island takes over. Everything it does afterwards goes
 * through the same endpoint the page used — no arithmetic here.
 */
export default function LoanCalculator({ initial }: { initial: PaymentPlan }) {
  const [plan, setPlan] = useState(initial);
  const [amount, setAmount] = useState(String(initial.amount));
  const [term, setTerm] = useState(String(initial.term));
  const [rate, setRate] = useState(String(initial.interestRate));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function recalculate(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    // Normalized with the shared contract before it is sent, so the island and
    // the route cannot ask the same question in two different ways.
    const search = new URLSearchParams({
      amount: calculatorNormalizers.amount!(amount),
      term: calculatorNormalizers.term!(term),
      rate: calculatorNormalizers.rate!(rate),
    });
    try {
      const response = await fetch(\`/api/calculator?\${search}\`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(String(response.status));
      setPlan((await response.json()) as PaymentPlan);
      // The URL follows the state, so the result stays shareable and the back
      // button returns to the previous plan instead of leaving the page.
      window.history.replaceState(null, "", \`/calculator?\${search}\`);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={recalculate} method="get" action="/calculator">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Tutar</span>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            inputMode="numeric"
            name="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Vade (ay)</span>
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            name="term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          >
            {CALCULATOR_TERMS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Faiz oranı (%)</span>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            inputMode="decimal"
            name="rate"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </label>
      </div>

      {/* Also a real submit button: with no JavaScript this form is a GET to
          /calculator, which the route renders server-side. */}
      <button
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Hesaplanıyor…" : "Hesapla"}
      </button>

      {failed ? (
        <p role="alert" className="text-sm text-red-700">
          Hesaplama şu an yapılamadı. Değerleri değiştirip tekrar deneyin.
        </p>
      ) : null}

      <dl aria-live="polite" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-slate-500">Aylık taksit</dt>
          <dd className="text-lg font-semibold text-slate-900">
            {formatMoney(plan.monthlyPayment)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Toplam geri ödeme</dt>
          <dd className="text-lg font-semibold text-slate-900">{formatMoney(plan.totalPayment)}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Vade</dt>
          <dd className="text-lg font-semibold text-slate-900">{plan.term} ay</dd>
        </div>
      </dl>

      <details>
        <summary className="cursor-pointer text-sm text-slate-600">Ödeme planı</summary>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th scope="col" className="py-1">Ay</th>
              <th scope="col" className="py-1">Taksit</th>
              <th scope="col" className="py-1">Faiz</th>
              <th scope="col" className="py-1">Anapara</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.slice(0, 12).map((row) => (
              <tr key={row.month} className="border-t border-slate-100">
                <td className="py-1">{row.month}</td>
                <td className="py-1">{formatMoney(row.payment)}</td>
                <td className="py-1">{formatMoney(row.interest)}</td>
                <td className="py-1">{formatMoney(row.principal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="text-xs text-slate-500">
        Hesaplama sunucuda yapılır ({DEFAULT_CALCULATOR.rate}% varsayılan oran). Tarayıcıda faiz
        formülü tekrar edilmez — iki kopya, insanların karar verdiği bir sayıda iki farklı cevap
        demektir.
      </p>
    </form>
  );
}
`;

const calculatorTest = () => `import { routes } from "@server/routes";
import { describe, expect, it } from "vitest";

import { PageCacheId, pageCacheRegistry } from "~/lib/cache-keys";
import { calculatorNormalizers, calculatorSearch } from "~/lib/calculator-query";

function url(query: string): URL {
  return new URL(\`http://app.local/calculator\${query}\`);
}

describe("the calculator", () => {
  it("normalizes its inputs to a small, cacheable set", () => {
    const search = calculatorSearch(url("?amount=123456&term=7&rate=3.14159&utm_source=x"));

    expect(search.get("amount")).toBe("123000");
    expect(search.get("term")).toBe("36");
    expect(search.get("rate")).toBe("3.14");
    // Every extra digit and every stray param would be another cache entry of
    // the same table.
    expect([...search.keys()]).toEqual(["amount", "term", "rate"]);
  });

  it("clamps rather than refuses, so a typed number always produces a plan", () => {
    expect(calculatorSearch(url("?amount=1")).get("amount")).toBe("10000");
    expect(calculatorSearch(url("?rate=99")).get("rate")).toBe("10");
    expect(calculatorSearch(url("?amount=abc")).get("amount")).toBe("100000");
  });

  it("uses one contract for the page, the cache key and the API", () => {
    const contentQuery = pageCacheRegistry[PageCacheId.calculator].contentQuery;

    // The island calls /api/calculator with these same normalizers. If they
    // diverged, the plan on screen would not be the plan the URL renders.
    expect(contentQuery?.include).toEqual(["amount", "term", "rate"]);
    expect(contentQuery?.normalize).toBe(calculatorNormalizers);
  });

  it("renders a plan on the server so the page works without JavaScript", () => {
    const route = routes.find((entry) => entry.path === "/calculator");

    expect(route).toBeDefined();
    // A tool whose first result only exists after hydration is a blank box to a
    // crawler and to anyone whose script did not load.
    expect(route?.loader).toBeTypeOf("function");
  });
});
`;

const quoteQueryLib = () => `/**
 * The quote's query contract: how much, and for how long.
 *
 * Same rule as the catalogue's — one place, read by the loader and by the cache
 * key. A quote is a page like any other: \`/items/alpha?amount=250000&term=36\` is
 * shared by everyone who asks for that amount and that term, and is cached as
 * such. Nothing about it is personal, which is exactly why it can be.
 */
export const QUOTE_QUERY = ["amount", "term"] as const;

export const QUOTE_TERMS = [12, 24, 36, 48, 60] as const;
export const DEFAULT_AMOUNT = 100_000;
export const DEFAULT_TERM = 36;

const MIN_AMOUNT = 10_000;
const MAX_AMOUNT = 5_000_000;
const AMOUNT_STEP = 1_000;

const TERMS = new Set<number>(QUOTE_TERMS);

/**
 * Clamped and rounded to a step rather than rejected.
 *
 * Two reasons. A visitor typing an amount should get a quote, not a 404. And
 * every distinct amount would otherwise be its own cache entry — the step is
 * what keeps a slider from turning one page into ten thousand.
 */
export const quoteNormalizers: Record<string, (raw: string | null) => string> = {
  amount: (raw) => {
    // \`Number(null)\` is 0, not NaN — so an absent value has to be handled before
    // the numeric path, or "no amount given" silently becomes "the minimum".
    if (raw === null || raw.trim() === "") return String(DEFAULT_AMOUNT);
    const value = Number(raw);
    if (!Number.isFinite(value)) return String(DEFAULT_AMOUNT);
    const clamped = Math.min(MAX_AMOUNT, Math.max(MIN_AMOUNT, value));
    return String(Math.round(clamped / AMOUNT_STEP) * AMOUNT_STEP);
  },
  term: (raw) => {
    if (raw === null || raw.trim() === "") return String(DEFAULT_TERM);
    const value = Number(raw);
    return String(TERMS.has(value) ? value : DEFAULT_TERM);
  },
};

/** The URL as the gateway should see it: allowlisted, normalized, ordered. */
export function quoteSearch(url: URL): URLSearchParams {
  const search = new URLSearchParams();
  for (const name of QUOTE_QUERY) {
    search.set(name, quoteNormalizers[name]!(url.searchParams.get(name)));
  }
  return search;
}

/** A quote URL with one value changed, defaults dropped so one page keeps one URL. */
export function quoteHref(
  slug: string,
  current: URLSearchParams,
  patch: Record<string, string>,
): string {
  const next = new URLSearchParams();
  for (const name of QUOTE_QUERY) {
    const raw = name in patch ? patch[name]! : current.get(name);
    const normalized = quoteNormalizers[name]!(raw ?? null);
    if (normalized !== quoteNormalizers[name]!(null)) next.set(name, normalized);
  }
  const query = next.toString();
  return query ? \`/items/\${slug}?\${query}\` : \`/items/\${slug}\`;
}

/** One place for money formatting, so the page and the island cannot disagree. */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}
`;

const catalogQueryLib = () => `/**
 * The catalog's query contract, in one place.
 *
 * Two things read it and they must agree: the loader, which turns a URL into an
 * upstream request, and the cache key, which decides whether two URLs are the
 * same page. Splitting them is how \`?sortBy=name\` ends up serving the cached
 * HTML of \`?sortBy=newest\`.
 */

/** Allowlist. A param not named here reaches neither the gateway nor the key. */
export const CATALOG_QUERY = ["category", "sortBy", "page"] as const;

export const CATALOG_CATEGORIES = ["all", "konut", "ihtiyac", "tasit"] as const;
export const CATALOG_SORTS = ["recommended", "rate-asc", "name-asc", "newest"] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];
export type CatalogSort = (typeof CATALOG_SORTS)[number];

const CATEGORIES = new Set<string>(CATALOG_CATEGORIES);
const SORTS = new Set<string>(CATALOG_SORTS);

/**
 * Every normalizer answers the same question: what is the canonical form of this
 * value? An unknown value is not an error here — it is the default, because a
 * visitor arriving with \`?category=nonsense\` should see the catalog, not a 404.
 */
export const catalogNormalizers: Record<string, (raw: string | null) => string> = {
  category: (raw) => (raw && CATEGORIES.has(raw) ? raw : "all"),
  sortBy: (raw) => (raw && SORTS.has(raw) ? raw : "recommended"),
  page: (raw) => {
    const page = Number(raw);
    return Number.isSafeInteger(page) && page > 1 ? String(page) : "1";
  },
};

/** The URL as the gateway should see it: allowlisted, normalized, ordered. */
export function catalogSearch(url: URL, perPage: number): URLSearchParams {
  const search = new URLSearchParams();
  for (const name of CATALOG_QUERY) {
    search.set(name, catalogNormalizers[name]!(url.searchParams.get(name)));
  }
  search.set("perPage", String(perPage));
  return search;
}

/** The same request built from values rather than a URL, for callers without one. */
export function itemsQuery(options: { page?: number; perPage?: number } = {}): URLSearchParams {
  return new URLSearchParams({
    category: "all",
    sortBy: "recommended",
    page: String(options.page ?? 1),
    perPage: String(options.perPage ?? 20),
  });
}

/**
 * A catalog URL with one filter changed and the rest kept.
 *
 * Changing a filter resets the page: page 4 of "all" is rarely page 4 of
 * "tools", and a visitor who lands on an empty page 4 reads it as no results.
 * Defaults are dropped so the first page of the unfiltered catalog is \`/catalog\`
 * and not \`/catalog?category=all&sortBy=recommended&page=1\`.
 */
export function catalogHref(current: URLSearchParams, patch: Record<string, string>): string {
  const resetsPage = ("category" in patch || "sortBy" in patch) && !("page" in patch);
  const next = new URLSearchParams();
  for (const name of CATALOG_QUERY) {
    if (name === "page" && resetsPage) continue;
    const raw = name in patch ? patch[name]! : current.get(name);
    const normalized = catalogNormalizers[name]!(raw ?? null);
    // A default carries no information, and leaving it out keeps one page on one
    // URL — which is also the one the cache key resolves to.
    if (normalized !== catalogNormalizers[name]!(null)) next.set(name, normalized);
  }
  const query = next.toString();
  return query ? \`/catalog?\${query}\` : "/catalog";
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
  const base = buildLayoutClientProps(ctx, opts);
  // The device is already resolved for the cache fragment, and it is the same
  // value the gateway is asked with — so the menu and the HTML key agree.
  const menu = await getMenu(ctx.request, base.deviceType);
  return { ...base, menu };
}
`;

const menuService =
  () => `import { gatewayFetch, requireGatewayOk } from "@originloom/core/adapters/gateway";
import * as cache from "@originloom/core/cache";
import { config } from "@originloom/core/config";
import { parseGatewayPayload, readGatewayJson } from "@originloom/core/gateway-payload";
import { logger } from "@originloom/core/logger";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import { memoizeRequestValue } from "@originloom/core/observability";
import {
  normalizeMetadataImageUrl,
  normalizeNavigationUrl,
} from "@originloom/shared/lib/content-url";
import type { DeviceType } from "@originloom/shared/lib/device";
import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import { productConfig } from "@server/product/config";

import { menuCacheKey } from "~/lib/cache-keys";
import { EMPTY_MENU, type IMenuItems, type MenuItem } from "~/lib/menu";

import { GatewayContracts } from "./gateway-contracts";

const MAX_MENU_DEPTH = 3;
const MAX_MENU_ITEMS = 200;
const MAX_ITEMS_PER_LEVEL = 50;
const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const INVALID_MENU = "Menu gateway returned an invalid payload";

/**
 * Last known good menu, kept per device so a cache hit does not re-parse JSON it
 * has already validated. Bounded by the number of device types, not by traffic.
 */
const parsedSnapshots = new Map<DeviceType, { body: string; menu: IMenuItems }>();

/**
 * The site's navigation, as the CMS defines it.
 *
 * One fetch per device per TTL for the whole fleet: the menu is the same for
 * every visitor on that device, so it is endpoint-cached rather than fetched per
 * page. \`memoizeRequestValue\` collapses the several places in one render that
 * ask for it into a single call.
 */
export function getMenu(request: Request, device: DeviceType): Promise<IMenuItems> {
  return memoizeRequestValue(\`gateway:menu:\${device}\`, () => loadMenu(request, device));
}

async function loadMenu(request: Request, device: DeviceType): Promise<IMenuItems> {
  const policy = {
    kind: "shared" as const,
    ttl: productConfig.menuCacheTtl,
    swr: productConfig.menuCacheSwr,
    key: [menuCacheKey(device)],
  };

  try {
    const key = cache.cacheKey(policy);

    if (key) {
      const hit = await cache.read(key);
      if (hit) {
        const snapshot = parsedSnapshots.get(device);
        if (snapshot?.body === hit.body) return snapshot.menu;
        try {
          const cached: unknown = JSON.parse(hit.body);
          const menu = parseMenuPayload(cached);
          if (menu) {
            const immutable = freezeMenu(menu);
            parsedSnapshots.set(device, { body: hit.body, menu: immutable });
            return immutable;
          }
        } catch {
          // Corrupt or older entries are a miss, not a failure.
        }
        await cache.deleteKey(key);
      }
    }

    const data = freezeMenu(await fetchMenuFromGateway(request, device));
    if (key) {
      const body = JSON.stringify(data);
      await cache.write(key, body, policy);
      parsedSnapshots.set(device, { body, menu: data });
    }
    return data;
  } catch (error) {
    if (isRequestDeadlineError(error) || request.signal.aborted) throw error;
    // A missing menu costs navigation; a thrown one costs the page. The site
    // renders without a menu and the failure is loud in the logs.
    logger.warn("menu degraded to empty", {
      device,
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_MENU;
  }
}

async function fetchMenuFromGateway(request: Request, device: DeviceType): Promise<IMenuItems> {
  // No identity either. This answer is shared by every visitor on that device
  // and cached under one key per device, so a tracking id or a client IP would
  // name something the response cannot depend on. \`device\` is the one dimension
  // that does matter, and it is sent explicitly.
  const response = await gatewayFetch("/pages/menuitem/list", {
    headers: { "content-type": "application/json", device },
    signal: request.signal,
  });
  await requireGatewayOk(response, "Menu gateway returned");

  const data = await readGatewayJson(response, GatewayContracts.menu, INVALID_MENU);
  return parseGatewayPayload(GatewayContracts.menu, data, parseMenuPayload, INVALID_MENU);
}

/**
 * Parses rather than merely checks: URLs are normalized against this site, and
 * an item the upstream got wrong fails the whole menu instead of rendering a
 * link that goes somewhere unintended.
 */
function parseMenuPayload(data: unknown): IMenuItems | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const state = { count: 0 };
  const header = parseMenuList(value.headerItems, 1, state);
  const hamburger = parseMenuList(value.hamburgerItems, 1, state);
  const footer = parseMenuList(value.footerItems, 1, state);
  if (header === null || hamburger === null || footer === null) return null;

  const headerItems = header ?? hamburger ?? [];
  return {
    headerItems,
    // A gateway that only ships one list means the drawer shows the same items.
    hamburgerItems: hamburger ?? headerItems,
    footerItems: footer ?? [],
  };
}

function parseMenuList(
  value: unknown,
  depth: number,
  state: { count: number },
): MenuItem[] | undefined | null {
  if (value === undefined) return undefined;
  // Depth and count are bounded because this data becomes a render: an upstream
  // loop would otherwise become an unbounded one here.
  if (!Array.isArray(value) || depth > MAX_MENU_DEPTH || value.length > MAX_ITEMS_PER_LEVEL) {
    return null;
  }

  const items: MenuItem[] = [];
  for (const candidate of value) {
    state.count++;
    if (state.count > MAX_MENU_ITEMS) return null;
    const item = parseMenuItem(candidate, depth, state);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function parseMenuItem(value: unknown, depth: number, state: { count: number }): MenuItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!hasValidMenuFields(item)) return null;

  const external = item.external === true;
  if (typeof item.url !== "string") return null;
  // An internal link that is not a path, or an external one that is not an
  // allowed scheme, is dropped here rather than rendered and hoped about.
  const url = normalizeNavigationUrl(item.url, { siteUrl: config.siteUrl, external });
  if (!url) return null;

  // undefined means "absent"; null means "present and unusable", which fails the item.
  const imagePath = parseOptionalImageUrl(item.imagePath);
  const activeImagePath = parseOptionalImageUrl(item.activeImagePath);
  if (imagePath === null || activeImagePath === null) return null;

  const children = parseMenuList(item.subMenuItemList, depth + 1, state);
  if (children === null) return null;

  return {
    id: item.id as number,
    name: item.name as string,
    url,
    displayOrder: item.displayOrder as number,
    mobileDisplayOrder: item.mobileDisplayOrder as number,
    // Absent stays absent: an explicit \`undefined\` key is not the same shape as
    // no key at all under exactOptionalPropertyTypes. parentId survives as null.
    ...stripUndefined({
      parentId: item.parentId as number | null | undefined,
      hamburgerName: item.hamburgerName as string | undefined,
      description: item.description as string | undefined,
      imagePath,
      activeImagePath,
      external: item.external === undefined ? undefined : external,
      menuType: item.menuType as number | undefined,
      itemType: item.itemType as number | undefined,
      menuDisplayDeviceType: item.menuDisplayDeviceType as number | undefined,
      menuDisplayType: item.menuDisplayType as number | undefined,
      subMenuItemList: children?.length ? children : undefined,
    }),
  };
}

/** Everything the upstream must get right before the item is worth shaping. */
function hasValidMenuFields(item: Record<string, unknown>): boolean {
  return (
    isInteger(item.id) &&
    isBoundedString(item.name, MAX_LABEL_LENGTH) &&
    isInteger(item.displayOrder) &&
    isInteger(item.mobileDisplayOrder) &&
    isOptionalInteger(item.parentId, true) &&
    isOptionalInteger(item.menuType) &&
    isOptionalInteger(item.itemType) &&
    isOptionalInteger(item.menuDisplayDeviceType) &&
    isOptionalInteger(item.menuDisplayType) &&
    isOptionalString(item.hamburgerName, MAX_LABEL_LENGTH) &&
    isOptionalString(item.description, MAX_DESCRIPTION_LENGTH) &&
    (item.external === undefined || typeof item.external === "boolean")
  );
}

function parseOptionalImageUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return normalizeMetadataImageUrl(value, config.siteUrl);
}

/** Frozen so a cached menu cannot be mutated by whatever renders it. */
function freezeMenu(menu: IMenuItems): IMenuItems {
  const freezeItems = (items: MenuItem[]): MenuItem[] => {
    for (const item of items) {
      if (item.subMenuItemList) freezeItems(item.subMenuItemList);
      Object.freeze(item);
    }
    return Object.freeze(items) as MenuItem[];
  };
  freezeItems(menu.headerItems);
  freezeItems(menu.hamburgerItems);
  freezeItems(menu.footerItems);
  return Object.freeze(menu);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isOptionalInteger(value: unknown, nullable = false): boolean {
  return value === undefined || (nullable && value === null) || isInteger(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isOptionalString(value: unknown, max: number): boolean {
  return value === undefined || isBoundedString(value, max);
}

`;

const menuLib =
  () => `import type { IMenuItems, MenuItem } from "@originloom/shared/lib/menu/types";
import { MenuItemType } from "@originloom/shared/lib/menu/types";

export type { IMenuItems, MenuItem };
export { MenuItemType };

/** Nothing to show is a valid menu — the shell renders without one. */
export const EMPTY_MENU: IMenuItems = { headerItems: [], hamburgerItems: [], footerItems: [] };

/**
 * Desktop and mobile order the same items differently, and the gateway says how.
 * Sorting here rather than in the component keeps the two shells from drifting.
 */
export function orderedFor(items: readonly MenuItem[], shell: "desktop" | "mobile"): MenuItem[] {
  const order = (item: MenuItem) =>
    shell === "mobile" ? item.mobileDisplayOrder : item.displayOrder;
  return [...items].sort((a, b) => order(a) - order(b));
}

/** The label to use in the drawer, when the upstream gives a shorter one for it. */
export function drawerLabel(item: MenuItem): string {
  return item.hamburgerName ?? item.name;
}

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
import { logger } from "@originloom/core/logger";
import type { CspSources } from "@originloom/core/middleware/security";
import { sequencedScript } from "@originloom/shared/head-scripts";
import {
  eventQueueScript,
  gtmContainerUrl,
  gtmStartScript,
  trackingIdPushScript,
} from "@originloom/shared/lib/analytics/bootstrap";
import { configureAnalyticsFields } from "@originloom/shared/lib/analytics/config";

/**
 * The names this app's container reads. Set once, here, because they are a
 * contract with the tag manager and a rename must not be a search-and-replace.
 */
configureAnalyticsFields({
  trackingIdKey: process.env.ANALYTICS_TRACKING_ID_KEY?.trim() || "userTrackingId",
  fieldPrefix: process.env.ANALYTICS_FIELD_PREFIX ?? "",
  pageViewEvent: "GAVirtual",
});

/**
 * Efilli, and the one thing this file needs from it: its URL.
 *
 * One variable, because there is one script. Efilli pushes its own events —
 * \`efilli.consent\`, then \`efilli_essential_granted\` — and this file neither
 * names them nor waits for them.
 *
 * The URL comes from the environment the way the container id does. In
 * development the mock gateway stands in, so the chain really runs.
 */
const efilliUrl =
  process.env.EFILLI_SCRIPT_URL?.trim() ||
  (config.isProduction ? undefined : \`\${config.gatewayUrl}/vendor/consent.js\`);

const gtmContainerId = process.env.GTM_CONTAINER_ID?.trim();

/**
 * A missing consent tool is loud, not silent.
 *
 * The container is not gated on it: deciding which tags may fire is the consent
 * platform's job, not this file's. Refusing to load GTM because an environment
 * variable is unset would turn one misconfiguration into zero measurement —
 * which reads as "no traffic" rather than "someone forgot a variable", and is
 * found weeks later.
 */
if (config.isProduction && !efilliUrl) {
  logger.error("EFILLI_SCRIPT_URL is not set — the site is measuring without a consent tool");
}

/**
 * The head chain: four scripts, in this order, every time.
 *
 * Written as plain tags this would be four elements and no guarantee — one
 * \`async\` anywhere reorders the lot. The sequencer loads each step in order,
 * without blocking the parser, and starts the next one when the previous has
 * executed.
 *
 *   1. dataLayer exists   — before anything can push to it
 *   2. Efilli             — pushes its own events, whenever it decides to
 *   3. tracking id        — read from the cookie in the browser, never rendered
 *                           into the shared-cached HTML
 *   4. event queue        — installed before the container so it can hold
 *                           gtm.dom / gtm.load
 *   5. gtm.js             — the container
 *
 * **Nothing here waits for a consent event, and that is deliberate.** An earlier
 * version did, and the order stopped being an order: a returning visitor whose
 * decision Efilli already knows gets the event during execution, while a first
 * visit gets it when the banner is answered — ten seconds later, or never. The
 * chain then either continued at once or stalled until its timeout, so the same
 * site produced a different sequence in a normal window and an incognito one.
 *
 * Script order is a guarantee the browser gives for free. An event is a promise
 * about a person.
 */
export const analyticsSequence = sequencedScript(
  [
    // 1. So no step has to guard for its absence.
    { code: \`window.dataLayer=window.dataLayer||[];\` },
    // 2. Executes here; announces itself on its own schedule.
    ...(efilliUrl ? [{ src: efilliUrl }] : []),
    // 3. The visitor's own id, from their own cookie.
    {
      code: trackingIdPushScript({
        trackingIdKey: process.env.ANALYTICS_TRACKING_ID_KEY?.trim() || "userTrackingId",
        // Campaign values live in cookies the session step wrote, so they travel
        // with the visitor rather than only with the URL they arrived on.
        extraCookies: { gclid: "gclid", utmSource: "utm_source", utmCampaign: "utm_campaign" },
      }),
    },
    // 4. Before the container: it wraps \`dataLayer.push\`, and it can only hold
    //    events that are pushed after it is installed.
    { code: eventQueueScript({ failOpenMs: 5_000 }) },
    // 5. The container. Without an id the chain simply ends here, which is the
    //    correct behaviour in a development checkout with no GTM property.
    ...(gtmContainerId
      ? [{ code: gtmStartScript() }, { src: gtmContainerUrl(gtmContainerId) }]
      : []),
  ],
  // A vendor that never loads must not strand the steps behind it.
  { timeoutMs: 4_000 },
);

/** The origins the sequence reaches. Without these the browser refuses to load them. */
export const analyticsCsp: CspSources = {
  scriptSrc: [
    ...(efilliUrl ? [new URL(efilliUrl).origin] : []),
    ...(gtmContainerId ? ["https://www.googletagmanager.com"] : []),
  ],
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

const pageAnalyticsIsland =
  () => `import { pushPageView } from "@originloom/shared/lib/analytics/page-view";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import { useLayoutEffect } from "react";

/**
 * The page view, pushed once per rendered page.
 *
 * \`useLayoutEffect\` rather than \`useEffect\`: the head bootstrap is holding
 * \`gtm.dom\` and \`gtm.load\` until this lands, and every frame it waits is a frame
 * the tags are held back. Nothing is rendered — this island exists to push.
 */
export default function PageAnalytics(props: PageAnalyticsMeta) {
  useLayoutEffect(() => {
    pushPageView(props);
  }, [props]);

  return null;
}
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
            <Link className="hover:underline" href="/items/konut-avantaj">
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
            <Link className="hover:underline" href="/products/konut-avantaj?source=home">
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
            <Link className="hover:underline" href="/no-cache">
              /no-cache
            </Link>{" "}
            — hiç cache yok: her istek gateway'e gider (karşılaştırma tabanı)
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

const rootLayout = (title) => `import { Island } from "@originloom/react/lib/island";
import { Link } from "@originloom/react/lib/link";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ReactNode } from "react";

import { drawerLabel, type MenuItem, orderedFor } from "~/lib/menu";
import type { ShellData } from "~/lib/shell-data";

export type RootLayoutProps = {
  shell: ShellData;
  pageMeta: PageAnalyticsMeta;
  children: ReactNode;
};

// Kept out of the markup so the JSX layout does not depend on how long the name is.
const SITE_NAME = "${title}";

/** Application shell. Header/footer that need their own cache lifetime belong in fragments. */
export function RootLayout({ shell, pageMeta, children }: RootLayoutProps) {
  const header = orderedFor(shell.menu.headerItems, shell.deviceShell);
  const drawer = orderedFor(shell.menu.hamburgerItems, shell.deviceShell);
  const footer = orderedFor(shell.menu.footerItems, shell.deviceShell);

  return (
    <div className="flex min-h-screen flex-col">
      {shell.minimalChrome ? null : (
        <header className="border-b border-slate-200">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              {SITE_NAME}
            </Link>

            <nav aria-label="Ana menü" className="hidden md:block">
              <ul className="flex gap-4 text-sm text-slate-600">
                {header.map((item) => (
                  <li key={item.id} className="group relative">
                    <TopLink item={item} shell={shell.deviceShell} />
                    {item.subMenuItemList?.length ? (
                      // Hover *and* focus-within: a submenu that only opens on
                      // hover cannot be reached with a keyboard at all.
                      <ul className="invisible absolute left-0 top-full z-10 min-w-52 rounded-lg border border-slate-200 bg-white p-2 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                        {orderedFor(item.subMenuItemList, shell.deviceShell).map((child) => (
                          <li key={child.id}>
                            <Link
                              className="block rounded px-2 py-1 hover:bg-slate-50 hover:text-slate-950"
                              href={child.url}
                              {...(child.external ? { target: "_blank" } : {})}
                            >
                              {child.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </nav>

            {/* No JavaScript: <details> is the drawer. It works before hydration
                and keeps working if hydration never happens. */}
            <details className="md:hidden">
              <summary className="cursor-pointer list-none rounded border border-slate-200 px-3 py-1 text-sm text-slate-700">
                Menü
              </summary>
              <nav aria-label="Mobil menü" className="absolute left-0 right-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
                <ul className="space-y-2 text-sm text-slate-700">
                  {drawer.map((item) => (
                    <li key={item.id}>
                      <Link className="font-medium hover:underline" href={item.url}>
                        {drawerLabel(item)}
                      </Link>
                      {item.subMenuItemList?.length ? (
                        <ul className="mt-1 space-y-1 pl-4 text-slate-600">
                          {orderedFor(item.subMenuItemList, shell.deviceShell).map((child) => (
                            <li key={child.id}>
                              <Link className="hover:underline" href={child.url}>
                                {drawerLabel(child)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </nav>
            </details>
          </div>
        </header>
      )}

      <main id="page-main" className="flex-1 py-10">
        <div className="mx-auto max-w-5xl px-4">{children}</div>
      </main>

      {/* Renders nothing; it exists to push the page view. \`eager\` because the
          head bootstrap is holding gtm.dom and gtm.load until it does, and every
          frame it waits is a frame the tags are held back. */}
      <Island name="page-analytics" mode="defer" eager props={pageMeta} />

      {shell.minimalChrome ? null : (
        <footer className="border-t border-slate-200 py-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 text-sm text-slate-500">
            <span>{SITE_NAME} — OriginLoom</span>
            <nav aria-label="Alt menü">
              <ul className="flex flex-wrap gap-4">
                {footer.map((item) => (
                  <li key={item.id}>
                    <Link
                      className="hover:text-slate-800 hover:underline"
                      href={item.url}
                      {...(item.external ? { target: "_blank" } : {})}
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </footer>
      )}
    </div>
  );
}

function TopLink({ item, shell }: { item: MenuItem; shell: "desktop" | "mobile" }) {
  return (
    <Link
      className="inline-block py-1 hover:text-slate-950 hover:underline"
      href={item.url}
      {...(item.external ? { target: "_blank" } : {})}
    >
      {shell === "mobile" ? drawerLabel(item) : item.name}
    </Link>
  );
}

`;

const libShellData = () => `import type { Ctx } from "@originloom/react/lib/types";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import { Cookie } from "@originloom/shared/lib/cookies";
import type { DeviceType } from "@originloom/shared/lib/device";
import { deviceCacheFragment, getDeviceShell } from "@originloom/shared/lib/device";
import { cookie } from "@originloom/shared/lib/request";

import { EMPTY_MENU, type IMenuItems } from "~/lib/menu";

/** Cache-safe props for the shell — no trackingId, no auth tokens. */
export type ShellData = {
  publicPath: string;
  pathname: string;
  theme?: string;
  minimalChrome?: boolean;
  deviceType: DeviceType;
  deviceShell: "desktop" | "mobile";
  menu: IMenuItems;
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
    menu: EMPTY_MENU,
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
import type { DeviceType } from "@originloom/shared/lib/device";

import {
  CALCULATOR_QUERY,
  calculatorNormalizers,
  DEFAULT_CALCULATOR,
} from "~/lib/calculator-query";
import { CATALOG_QUERY, catalogNormalizers } from "~/lib/catalog-query";
import { DEFAULT_AMOUNT, DEFAULT_TERM, QUOTE_QUERY, quoteNormalizers } from "~/lib/quote-query";
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
  calculator: "calculator",
  guides: "guides",
  guideDetail: "guide-detail",
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

/**
 * What every cached page varies on, declared once.
 *
 * A dimension multiplies the entries for every page that uses it, so each one
 * has to earn its place: it belongs here only if the HTML actually differs along
 * it. Adding one is a line, and so is removing one.
 */
function sharedDimensions(ctx: Ctx): string[] {
  return [
    // The shell differs between desktop and mobile, so the HTML does.
    layoutCacheFragment(ctx),

    // Multi-language site? Add \`locale(ctx.request)\` and every key splits per
    // language. It is not here by default because a single-language app would
    // then store the same bytes twice — once under \`tr\` and once under \`en\` —
    // for pages that render identically.

    // Per-tenant, per-country, per-currency: same shape. Return the value here
    // and every page inherits it. Never return something with one value per
    // visitor: an entry per person is not a cache.
  ];
}

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
    buildKey: (ctx) => ["home", ...sharedDimensions(ctx)],
  },
  [PageCacheId.catalog]: {
    id: PageCacheId.catalog,
    description: "Katalog (sayfalı)",
    path: "/catalog",
    strategy: "shared",
    // The registry and the loader read the same contract, so a URL the loader
    // treats as the unfiltered catalog cannot land on a different key.
    contentQuery: {
      include: [...CATALOG_QUERY],
      defaults: { category: "all", sortBy: "recommended", page: "1" },
      normalize: catalogNormalizers,
    },
    // Only allowlisted, normalized content params enter the key. Tracking and
    // unknown params cannot fragment the shared HTML cache.
    buildKey: (ctx) => [
      "catalog",
      contentQueryCacheFragment(ctx, pageCacheRegistry[PageCacheId.catalog].contentQuery!),
      ...sharedDimensions(ctx),
    ],
  },
  [PageCacheId.guides]: {
    id: PageCacheId.guides,
    description: "Rehber listesi",
    path: "/guides",
    strategy: "shared",
    ttl: 1800,
    buildKey: (ctx) => ["guides", ...sharedDimensions(ctx)],
  },
  [PageCacheId.guideDetail]: {
    id: PageCacheId.guideDetail,
    description: "Rehber detayı",
    path: "/guides/:slug",
    strategy: "shared",
    ttl: 1800,
    buildKey: (ctx) => [
      "guide-detail",
      ctx.params.slug ?? "",
      ...sharedDimensions(ctx),
    ],
  },
  [PageCacheId.calculator]: {
    id: PageCacheId.calculator,
    description: "Kredi hesaplama aracı",
    path: "/calculator",
    strategy: "shared",
    // The inputs are the page. Normalized to a small set first, so a slider
    // cannot turn one tool into a million cache entries.
    contentQuery: {
      include: [...CALCULATOR_QUERY],
      defaults: {
        amount: String(DEFAULT_CALCULATOR.amount),
        term: String(DEFAULT_CALCULATOR.term),
        rate: String(DEFAULT_CALCULATOR.rate),
      },
      normalize: calculatorNormalizers,
    },
    buildKey: (ctx) => [
      "calculator",
      contentQueryCacheFragment(ctx, pageCacheRegistry[PageCacheId.calculator].contentQuery!),
      ...sharedDimensions(ctx),
    ],
  },
  [PageCacheId.itemDetail]: {
    id: PageCacheId.itemDetail,
    description: "Ürün detayı (teklif sorgulu)",
    path: "/items/:slug",
    strategy: "shared",
    // The quote is part of what identifies this page: the same product at a
    // different amount is different HTML. Normalized first, so a slider cannot
    // turn one page into ten thousand cache entries.
    contentQuery: {
      include: [...QUOTE_QUERY],
      defaults: { amount: String(DEFAULT_AMOUNT), term: String(DEFAULT_TERM) },
      normalize: quoteNormalizers,
    },
    // The slug fragments the cache — each item gets its own entry.
    buildKey: (ctx) => [
      "item-detail",
      ctx.params.slug ?? "",
      contentQueryCacheFragment(ctx, pageCacheRegistry[PageCacheId.itemDetail].contentQuery!),
      ...sharedDimensions(ctx),
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
    buildKey: (ctx) => ["media", ...sharedDimensions(ctx)],
  },
  [PageCacheId.showcase]: {
    id: PageCacheId.showcase,
    description: "Fragment örneği",
    path: "/showcase",
    strategy: "shared",
    // Page cached for an hour; the fragment it embeds has its own 15s TTL.
    ttl: 3600,
    buildKey: (ctx) => ["showcase", ...sharedDimensions(ctx)],
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

/**
 * Route resolver plus build-readable metadata; runtime policy remains authoritative.
 *
 * The resolver is overridable because some routes decide per request: a URL that
 * is about to 404 or redirect should not be cached under the key of the page it
 * is not. See server/routes/catalog.tsx.
 */
export function pageCache(
  id: PageCacheId,
  resolver: (ctx: Ctx) => CachePolicy = (ctx) => pageCachePolicy(id, ctx),
): RouteCacheResolver {
  const entry = pageCacheRegistry[id];
  if (entry.strategy === "never") {
    return describeRouteCache(resolver, {
      mode: "none",
      label: entry.description,
    });
  }
  return describeRouteCache(resolver, {
    mode: "conditional",
    ttl: entry.ttl ?? DEFAULT_TTL,
    swr: entry.swr ?? DEFAULT_SWR,
    ...(entry.contentQuery?.include.length ? { vary: entry.contentQuery.include } : {}),
    label: entry.description,
  });
}

/**
 * The menu is endpoint data, not a page, so it has its own key rather than an
 * entry in the page registry. Device is part of it because the answer is.
 */
export function menuCacheKey(device: DeviceType): string {
  return \`menu:\${device}\`;
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

const dockerfile = (name, port, standalone, packageManager = "pnpm") =>
  standalone
    ? standaloneDockerfile(name, port, packageManager)
    : workspaceDockerfile(name, port);

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
// PM-specific standalone Dockerfiles live in package-manager-templates.mjs.

const readme = (name, title, port, vitePort, standalone, withOps, packageManager = "pnpm") => `# ${title}

OriginLoom ürün uygulaması. Platform runtime'ı \`@originloom/core\` ve \`@originloom/react\`
paketlerinden gelir; bu repo route tablosunu, ürün kontratlarını, cache kimliğini ve kendi UI'ını
sahiplenir.

## Gereksinimler

- Node.js 22.19 veya üzeri
${packageManagerRequirements(packageManager)}
${standalone ? "- `@originloom/*` paketlerinin bulunduğu registry'ye erişim" : "- OriginLoom monorepo kökünde çalışmak"}

## Kurulum ve ilk çalıştırma

${readmeInstallBlock(packageManager, standalone, name)}

| Servis              | Adres/port                        | Not                                      |
| ------------------- | --------------------------------- | ---------------------------------------- |
| SSR uygulaması      | \`http://127.0.0.1:${port}\`       | Browser'ın açacağı adres                 |
| Vite dev server     | \`http://127.0.0.1:${vitePort}\`   | Client modülleri; doğrudan açmayın       |
| Mock gateway        | \`.env.development:GATEWAY_URL\`   | Yalnız \`pnpm dev:mock\` başlatır       |
| Metrics/operations  | \`:${port + 6000}\`                | Development'ta kapalı (METRICS_ENABLED)  |

Gerçek entegrasyonda \`.env.development\` içindeki \`GATEWAY_URL\` değerini değiştirin ve
\`mock-gateway/server.mjs\` payload'larını gerçek kontratlarla karşılaştırın. Production secret'larını
dosyaya yazmak yerine secret manager/CI üzerinden verin.

## Çalışan örnekler

- \`/catalog\`: facet, sıralama ve sayfalama; allowlist'li normalize query cache key'e girer,
  \`?page=1\` 308, \`?page=abc\` ve aralık dışı 404, SEO metni gateway'den
- \`/catalog/tools\`: geçerli değerleri gateway'in sahiplendiği param — \`validateParams\` + 301
- \`/items/konut-avantaj?amount=250000&term=36\`: param validation, \`notFound()\`, tutar/vadeye göre
  sunucuda hesaplanan teklif (normalize query cache key'e girer), ikinci gateway çağrısı
  (değerlendirmeler), breadcrumb + FinancialProduct + AggregateRating JSON-LD, sağlayıcıya
  yönlendirme formu
- \`/calculator\`: SSR ile üretilen ilk sonuç + aynı public API'yi çağıran island; JS kapalıyken
  form GET olarak çalışır
- \`/guides\` ve \`/guides/:slug\`: editoryal içerik, \`Article\` + \`FAQPage\` yapısal verisi
- \`/data-cache\`: cache'siz HTML içinde TTL/SWR ile cache'lenen doğrulanmış gateway verisi
- \`/no-cache\`: hiçbir yerde cache yok — karşılaştırma için taban çizgisi
- \`/account\`: never-cache document, BFF session ve defer island
- Dinamik menü: platformun \`IMenuItems\` kontratı (header/hamburger/footer, iç içe, cihaza göre
  sıralı, external link), cihaz başına endpoint cache ve menüsüz de çalışan fallback
- \`/api/referrals\`: PRG + HttpOnly anonim oturum + allowlist'li dış yönlendirme (303)
- \`/live\`: progressive SSR, bounded SSE ve graceful shutdown
- \`/showcase\`: bağımsız TTL ile fragment stitching
- \`/media\`: responsive media ve unoptimized asset teslimi
- \`/old-catalog\`: query-string'i koruyan static \`308\` redirect
- \`/products/konut-avantaj\`: browser URL'sini koruyan internal rewrite
- \`/gateway/menu\`: yalnız açıkça izin verilen gateway endpoint'ine external proxy
- \`/legacy-catalog\` ve \`/removed-page\`: mock CMS redirect ve \`410 Gone\`

## Sık kullanılan komutlar

${readmeCommandTable(packageManager)}
<!-- @originloom:hook readme-ops-table -->

## Yapı

| Yol                       | Sorumluluk                                                               |
| ------------------------- | ------------------------------------------------------------------------ |
| \`server/index.ts\`         | Composition root: runtime, routing, app, metrics ve shutdown              |
| \`server/routes/\`          | Route tanımları: loader, cache, metadata ve React Component               |
| \`server/api/\`             | Public API/BFF ve SSE endpoint'leri                                      |
| \`server/product/\`         | Runtime, document shell, fragments, CSP ve boundary kontratları           |
| \`server/services/\`        | Gateway çağrıları, payload guard'ları ve background worker'lar            |
| \`server/metrics/\`         | Bounded product metric kaynakları                                        |
| \`mock-gateway/\`           | Local fixture; \`pnpm dev:mock\` ve \`pnpm smoke\` başlatır              |
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
- [Cache purge](docs/cache-purge.md)
- [Liste sayfaları: filtre, sıralama, sayfalama](docs/lists.md)
- [Route param doğrulama](docs/route-params.md)
- [Sağlayıcıya yönlendirme](docs/referrals.md)
- [Araç sayfaları (hesaplayıcı)](docs/tools.md)
- [Webhook alıcısı](docs/webhooks.md)
- [Analytics: dataLayer ve sıra](docs/analytics.md)
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

const mockGateway = (includeRoutingExamples = false) => `#!/usr/bin/env node
/**
 * Local stand-in for the upstream gateway, so the app runs before a real one
 * exists. \`pnpm dev:mock\` and \`pnpm smoke\` start it for you; \`pnpm dev\` does not,
 * because by then the gateway is usually someone else's process.
 *
 * Keep it dumb: fixed data in the shapes the real gateway returns. It is a
 * development fixture, not a second implementation of your backend.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GATEWAY_PORT ?? 4002);
const DELAY_MS = Math.max(0, Number(process.env.MOCK_GATEWAY_DELAY_MS ?? 0) || 0);
const REVIEW_DELAY_MS = Math.max(0, Number(process.env.MOCK_REVIEW_DELAY_MS ?? 900) || 0);
${
  includeRoutingExamples
    ? "const LIVE_MESSAGE_DELAY_MS = Math.max(0, Number(process.env.MOCK_LIVE_MESSAGE_DELAY_MS ?? 600) || 0);"
    : ""
}
const stats = { startedAt: new Date().toISOString(), total: 0, byPath: Object.create(null) };

// A small catalogue of credit products. \`addedAt\` and \`category\` exist so sorting
// and faceting have something real to do; the list is ordered by nothing in
// particular on purpose, because "recommended" is the upstream's own order and a
// client that assumes it is alphabetical breaks the moment a real gateway disagrees.
const ITEMS = [
  { slug: "konut-avantaj", name: "Konut Avantaj", blurb: "Uzun vadeli konut finansmanı.", category: "konut", provider: "Örnek Bank", interestRate: 2.79, minAmount: 50000, maxAmount: 5000000, terms: [12, 24, 36, 48, 60], addedAt: "2026-01-04", seo: { title: "Konut Avantaj", description: "Konut Avantaj kredisi detayları." } },
  { slug: "konut-esnek", name: "Konut Esnek", blurb: "Ara ödeme yapılabilen konut kredisi.", category: "konut", provider: "Deniz Finans", interestRate: 2.94, minAmount: 50000, maxAmount: 4000000, terms: [24, 36, 48, 60], addedAt: "2026-02-11", seo: { title: "Konut Esnek", description: "Konut Esnek kredisi detayları." } },
  { slug: "ihtiyac-hizli", name: "İhtiyaç Hızlı", blurb: "Aynı gün sonuçlanan ihtiyaç kredisi.", category: "ihtiyac", provider: "Örnek Bank", interestRate: 3.49, minAmount: 10000, maxAmount: 300000, terms: [12, 24, 36], addedAt: "2026-03-02", seo: { title: "İhtiyaç Hızlı", description: "İhtiyaç Hızlı kredisi detayları." } },
  { slug: "ihtiyac-uzun", name: "İhtiyaç Uzun", blurb: "48 aya varan vade seçeneği.", category: "ihtiyac", provider: "Anadolu Kredi", interestRate: 3.19, minAmount: 10000, maxAmount: 500000, terms: [24, 36, 48], addedAt: "2026-03-21", seo: { title: "İhtiyaç Uzun", description: "İhtiyaç Uzun kredisi detayları." } },
  { slug: "tasit-sifir", name: "Taşıt Sıfır", blurb: "Sıfır araç için taşıt kredisi.", category: "tasit", provider: "Deniz Finans", interestRate: 2.99, minAmount: 50000, maxAmount: 2000000, terms: [12, 24, 36, 48], addedAt: "2026-04-08", seo: { title: "Taşıt Sıfır", description: "Taşıt Sıfır kredisi detayları." } },
  { slug: "tasit-ikinci-el", name: "Taşıt İkinci El", blurb: "İkinci el araçlar için taşıt kredisi.", category: "tasit", provider: "Anadolu Kredi", interestRate: 3.35, minAmount: 25000, maxAmount: 1500000, terms: [12, 24, 36], addedAt: "2026-05-19", seo: { title: "Taşıt İkinci El", description: "Taşıt İkinci El kredisi detayları." } },
  { slug: "ihtiyac-ogrenci", name: "İhtiyaç Öğrenci", blurb: "Öğrencilere özel düşük limitli kredi.", category: "ihtiyac", provider: "Örnek Bank", interestRate: 2.49, minAmount: 10000, maxAmount: 100000, terms: [12, 24], addedAt: "2026-06-27", seo: { title: "İhtiyaç Öğrenci", description: "İhtiyaç Öğrenci kredisi detayları." } },
];

const GUIDES = [
  {
    slug: "konut-kredisi-rehberi",
    title: "Konut kredisi rehberi",
    excerpt: "Başvurudan önce bilmeniz gereken temel kavramlar.",
    category: "konut",
    author: "Ada Lovelace",
    tags: ["konut", "kredi", "faiz"],
    publishedAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    sections: [
      { heading: "Faiz nasıl hesaplanır?", body: "Taksitler anüite yöntemiyle hesaplanır: her taksitin bir kısmı faiz, kalanı anaparadır." },
      { heading: "Vade neyi değiştirir?", body: "Vade uzadıkça aylık taksit düşer, toplam geri ödeme artar." },
    ],
    faq: [
      { question: "Peşinat şart mı?", body: "", answer: "Konut kredilerinde genellikle konut değerinin %20'si kadar peşinat istenir." },
      { question: "Erken kapatma cezası var mı?", answer: "Kalan anaparaya göre sınırlı bir erken kapama ücreti uygulanabilir." },
    ],
  },
  {
    slug: "ihtiyac-kredisi-rehberi",
    title: "İhtiyaç kredisi rehberi",
    excerpt: "Limit, vade ve maliyet arasındaki dengeyi kurmak.",
    category: "ihtiyac",
    author: "Grace Hopper",
    tags: ["ihtiyac", "kredi"],
    publishedAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    sections: [
      { heading: "Yıllık maliyet oranı nedir?", body: "Faize ek olarak tüm masrafları içeren orandır; ürünleri karşılaştırırken bakılması gereken sayıdır." },
    ],
    faq: [
      { question: "Kaç ay vade seçebilirim?", answer: "Ürüne göre 12 ile 48 ay arasında değişir." },
    ],
  },
];

const REVIEWS = {
  "konut-avantaj": [
    { author: "Deniz", rating: 5, comment: "Süreç beklediğimden hızlı ilerledi." },
    { author: "Ece", rating: 4, comment: "Faiz oranı rakiplerine göre iyi." },
  ],
  "ihtiyac-hizli": [{ author: "Kerem", rating: 3, comment: "Onay hızlı ama limit düşük geldi." }],
};

/**
 * Annuity payment. Deliberately upstream: an interest formula duplicated in the
 * frontend is a second source of truth for a number people make decisions with.
 */
function quoteFor(item, amount, term) {
  const monthlyRate = item.interestRate / 100;
  const factor = Math.pow(1 + monthlyRate, term);
  const monthlyPayment = (amount * monthlyRate * factor) / (factor - 1);
  const totalPayment = monthlyPayment * term;
  return {
    amount,
    term,
    monthlyPayment: Math.round(monthlyPayment),
    totalPayment: Math.round(totalPayment),
    annualCostRate: Number((monthlyRate * 12 * 100).toFixed(2)),
  };
}

/** Clamped to the product's own limits, so a quote is never one it cannot honour. */
function requestedQuote(item, params) {
  const rawAmount = Number(params.get("amount"));
  const amount = Number.isFinite(rawAmount)
    ? Math.min(item.maxAmount, Math.max(item.minAmount, Math.round(rawAmount / 1000) * 1000))
    : Math.min(item.maxAmount, Math.max(item.minAmount, 100000));
  const rawTerm = Number(params.get("term"));
  const term = item.terms.includes(rawTerm) ? rawTerm : (item.terms[item.terms.length - 1] ?? 36);
  return quoteFor(item, amount, term);
}

const CATEGORIES = ["konut", "ihtiyac", "tasit"];
const SORTS = {
  recommended: () => 0,
  "name-asc": (a, b) => a.name.localeCompare(b.name, "tr"),
  newest: (a, b) => b.addedAt.localeCompare(a.addedAt),
  // The reason anyone sorts a credit list.
  "rate-asc": (a, b) => a.interestRate - b.interestRate,
};

/** What a CMS would return for the list page, including its indexing decision. */
function catalogSeoInfo(category, page) {
  const label = category === "all" ? "Krediler" : \`Krediler — \${category}\`;
  return {
    title: label,
    metaDescription: \`\${label} sayfası.\`,
    headingTitle: label,
    friendlyUrl: "/catalog",
    // A filtered, deep page is thin: the gateway decides that, not the route.
    noindex: category !== "all" && page > 1,
    nofollow: false,
    openGraphType: "website",
  };
}

const headerItems = [
  menuCategory(3, "Krediler", "/catalog", [
    menuItem(31, 3, "Tüm krediler", "/catalog", 1),
    menuItem(32, 3, "Konut kredisi", "/catalog?category=konut", 2),
    menuItem(33, 3, "İhtiyaç kredisi", "/catalog?category=ihtiyac", 3),
    menuItem(34, 3, "Taşıt kredisi", "/catalog?category=tasit", 4),
  ]),
  menuCategory(4, "Araçlar", "/calculator", [
    menuItem(41, 4, "Kredi hesaplama", "/calculator", 1),
    menuItem(42, 4, "API data cache", "/data-cache", 2),
    menuItem(43, 4, "Cache'siz sayfa", "/no-cache", 3),
  ]),
  menuItem(5, null, "Canlı veri", "/live", 5),
];

const MENU = {
  headerItems,
  hamburgerItems: headerItems,
  footerItems: [
    footerItem(100, "İletişim", "/contact", 1),
    footerItem(101, "Medya", "/media", 2),
    footerItem(102, "OriginLoom", "https://example.com/originloom", 3, true),
  ],
};

function menuCategory(id, name, url, subMenuItemList) {
  return { id, name, url, displayOrder: id, mobileDisplayOrder: id, itemType: 4, subMenuItemList };
}

function menuItem(id, parentId, name, url, order, hamburgerName) {
  return {
    id,
    ...(parentId === null ? {} : { parentId }),
    name,
    ...(hamburgerName ? { hamburgerName } : {}),
    url,
    displayOrder: order,
    mobileDisplayOrder: order,
    itemType: 4,
  };
}

function footerItem(id, name, url, order, external) {
  return {
    id,
    name,
    url,
    displayOrder: order,
    mobileDisplayOrder: order,
    itemType: 16,
    ...(external ? { external: true } : {}),
  };
}
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
  logRequest(req, url);
  if (DELAY_MS) await new Promise((resolveDelay) => setTimeout(resolveDelay, DELAY_MS));

  if (url.pathname === "/items") {
    const category = CATEGORIES.includes(url.searchParams.get("category") ?? "")
      ? url.searchParams.get("category")
      : "all";
    const sortBy = url.searchParams.get("sortBy") in SORTS ? url.searchParams.get("sortBy") : "recommended";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("perPage") ?? 3) || 3));

    const matching = ITEMS.filter((item) => category === "all" || item.category === category);
    const sorted = [...matching].sort(SORTS[sortBy]);
    const start = (page - 1) * perPage;

    return json(res, 200, {
      items: sorted.slice(start, start + perPage),
      total: matching.length,
      page,
      totalPages: Math.max(1, Math.ceil(matching.length / perPage)),
      // Counts come from the whole set, not the filtered one: a facet that only
      // ever shows the current selection cannot be used to leave it.
      facets: {
        categories: [
          { value: "all", count: ITEMS.length },
          ...CATEGORIES.map((value) => ({
            value,
            count: ITEMS.filter((item) => item.category === value).length,
          })),
        ],
      },
      // Echoed back so the page renders what the gateway understood, not what the
      // URL asked for. They differ whenever the upstream rejects a value.
      query: { category, sortBy },
      seoInfo: catalogSeoInfo(category, page),
    });
  }

  // Editorial content: guides with sections and questions.
  if (url.pathname === "/guides") {
    return json(res, 200, {
      items: GUIDES.map((guide) => ({
        slug: guide.slug,
        title: guide.title,
        excerpt: guide.excerpt,
        category: guide.category,
      })),
    });
  }

  const guideSlug = /^\\/guides\\/([^/]+)$/.exec(url.pathname);
  if (guideSlug) {
    const guide = GUIDES.find((entry) => entry.slug === decodeURIComponent(guideSlug[1]));
    if (!guide) return json(res, 404, { error: "not_found" });
    return json(res, 200, {
      guide,
      seoInfo: {
        title: guide.title,
        metaDescription: guide.excerpt,
        headingTitle: guide.title,
        image: "/assets/images/og-cover.svg",
        imageAlt: guide.title,
        friendlyUrl: "/guides/" + guide.slug,
        noindex: false,
        nofollow: false,
        openGraphType: "article",
        publishedTime: guide.publishedAt,
        modifiedTime: guide.updatedAt,
        author: guide.author,
        section: guide.category,
        tags: guide.tags,
      },
    });
  }

  // The payment plan, computed here so page and island share one implementation.
  if (url.pathname === "/calculators/loan") {
    const amount = Math.min(5000000, Math.max(10000, Number(url.searchParams.get("amount")) || 100000));
    const term = Math.min(480, Math.max(1, Number(url.searchParams.get("term")) || 36));
    const interestRate = Math.min(10, Math.max(0.1, Number(url.searchParams.get("rate")) || 3.1));

    const monthlyRate = interestRate / 100;
    const factor = Math.pow(1 + monthlyRate, term);
    const monthlyPayment = (amount * monthlyRate * factor) / (factor - 1);

    let remaining = amount;
    const rows = [];
    for (let month = 1; month <= term; month++) {
      const interest = remaining * monthlyRate;
      const principal = monthlyPayment - interest;
      remaining -= principal;
      rows.push({
        month,
        payment: Math.round(monthlyPayment),
        interest: Math.round(interest),
        principal: Math.round(principal),
      });
    }

    return json(res, 200, {
      amount,
      term,
      interestRate,
      monthlyPayment: Math.round(monthlyPayment),
      totalPayment: Math.round(monthlyPayment * term),
      rows,
    });
  }

  // The hand-off to the provider. A real gateway records it and mints a
  // one-time destination; this one just proves the shape.
  if (url.pathname === "/referrals" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, 400, { error: "invalid_json" });
    }
    const item = ITEMS.find((entry) => entry.slug === body?.slug);
    if (!item) return json(res, 404, { error: "not_found" });
    const referralId = "ref-" + Date.now().toString(36);
    return json(res, 201, {
      referralId,
      redirectUrl:
        "https://provider.example/basvuru/" +
        encodeURIComponent(item.slug) +
        "?ref=" +
        encodeURIComponent(referralId),
    });
  }

  // The slow half of the detail page. The delay is here rather than in the route
  // so the streaming example exercises the real app → gateway boundary.
  const reviews = /^\\/items\\/([^/]+)\\/reviews$/.exec(url.pathname);
  if (reviews) {
    if (REVIEW_DELAY_MS) await new Promise((resolveDelay) => setTimeout(resolveDelay, REVIEW_DELAY_MS));
    return json(res, 200, { reviews: REVIEWS[decodeURIComponent(reviews[1])] ?? [] });
  }

  // The CMS navigation: three lists, nested, ordered per device. The device
  // header is what makes the answer device-specific — see server/services/menu.ts.
  if (url.pathname === "/pages/menuitem/list") {
    return json(res, 200, MENU);
  }

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

  // Which route param values exist. Owned here rather than in the app because
  // they change when the catalogue does, not when the code does — see
  // server/services/route-domains.ts.
  // Which URLs exist. The app does not enumerate its own site: a sitemap
  // derived from one page of a catalogue silently omits the rest of it.
  if (url.pathname === "/seo/sitemap") {
    return json(res, 200, {
      entries: [
        { path: "/" },
        { path: "/catalog" },
        ...CATEGORIES.map((category) => ({ path: \`/catalog/\${category}\` })),
        ...ITEMS.map((item) => ({ path: \`/items/\${item.slug}\`, lastModified: item.addedAt })),
      ],
    });
  }

  if (url.pathname === "/routing/domains") {
    return json(res, 200, { categories: CATEGORIES });
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
    if (!item) return json(res, 404, { error: "not_found" });
    const quote = requestedQuote(item, url.searchParams);
    // The page's SEO copy travels with the page. A real CMS is where a title is
    // rewritten or a page is pulled from the index, and neither should be a deploy.
    return json(res, 200, {
      item,
      quote,
      seoInfo: {
        title: item.seo.title,
        metaDescription: item.seo.description,
        headingTitle: item.name,
        image: "/assets/images/og-cover.svg",
        imageAlt: \`\${item.name} kapak görseli\`,
        imageWidth: 1200,
        imageHeight: 630,
        friendlyUrl: \`/items/\${item.slug}\`,
        noindex: false,
        nofollow: false,
        openGraphType: "product",
        modifiedTime: \`\${item.addedAt}T00:00:00.000Z\`,
      },
    });
  }

  // Stands in for Efilli: it executes at once and decides a moment later, which
  // is the case document order cannot express. See server/product/analytics.ts.
  if (url.pathname === "/vendor/consent.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    // Announces itself the way a real consent tool does for a visitor whose
    // decision it already has: two dataLayer pushes, synchronously, while it
    // executes. A first-time visitor's would arrive whenever the banner is
    // answered — which is exactly why nothing in the chain waits for it.
    return res.end(
      'window.dataLayer=window.dataLayer||[];window.__consent=true;' +
        'window.dataLayer.push({event:"efilli.consent",categories:{essential:true}});' +
        'window.dataLayer.push({event:"efilli_essential_granted"});',
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
}

/**
 * What the app actually sent, printed where you can read it.
 *
 * The identity headers are on every line because they are the ones you check
 * when something upstream looks wrong: is the tracking id there on a first
 * visit, is the client IP the visitor's or the proxy's, is the device what the
 * page cached under. \`MOCK_GW_HEADERS=1\` prints the whole set when that is not
 * enough; \`MOCK_GW_QUIET=1\` turns the log off for load tests.
 */
function logRequest(req, url) {
  if (process.env.MOCK_GW_QUIET) return;
  const h = req.headers;
  console.log(
    \`[mock-gw] \${req.method} \${url.pathname}\${url.search} · tracking=\${h["x-user-tracking-id"] ?? "-"} ip=\${h["x-client-ip"] ?? "-"} device=\${h["device"] ?? h["x-device-type"] ?? "-"} auth=\${h.authorization ? "yes" : "no"}\`,
  );
  if (!process.env.MOCK_GW_HEADERS) return;
  for (const [name, value] of Object.entries(h)) {
    // Never print the value of a credential: a terminal scrollback and a
    // screenshot are both places a token should not end up.
    const shown = REDACTED_HEADERS.has(name) ? "<redacted>" : value;
    console.log(\`[mock-gw]     \${name}: \${shown}\`);
  }
}

const REDACTED_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);`
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
  calculator: defineGatewayContract("calculator", 131_072),
  guides: defineGatewayContract("guides", 262_144),
  referral: defineGatewayContract("referral", 4_096),
  routing: defineGatewayContract("routing", 4_096),
  routeDomains: defineGatewayContract("route_domains", 16_384),
  sitemap: defineGatewayContract("sitemap", 4_194_304),
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
                description: "Item detail page",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/ItemDetail" } },
                },
              },
            },
          },
        },
        "/items/{slug}/reviews": {
          get: {
            responses: {
              200: {
                description: "Item reviews",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/ItemReviews" } },
                },
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
        "/pages/menuitem/list": {
          get: {
            responses: {
              200: {
                description: "CMS navigation",
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
            required: [
              "slug",
              "name",
              "blurb",
              "category",
              "provider",
              "interestRate",
              "minAmount",
              "maxAmount",
              "terms",
              "seo",
            ],
            properties: {
              slug: { type: "string", maxLength: 100 },
              name: { type: "string", maxLength: 200 },
              blurb: { type: "string", maxLength: 1000 },
              category: { type: "string", maxLength: 60 },
              provider: { type: "string", maxLength: 120 },
              interestRate: { type: "number", minimum: 0, maximum: 100 },
              minAmount: { type: "number", minimum: 0 },
              maxAmount: { type: "number", minimum: 0 },
              terms: { type: "array", maxItems: 20, items: { type: "integer", minimum: 1 } },
              seo: { $ref: "#/components/schemas/ItemSeo" },
            },
            additionalProperties: true,
          },
          ItemQuote: {
            type: "object",
            required: ["amount", "term", "monthlyPayment", "totalPayment", "annualCostRate"],
            properties: {
              amount: { type: "number", minimum: 0 },
              term: { type: "integer", minimum: 1 },
              monthlyPayment: { type: "number", minimum: 0 },
              totalPayment: { type: "number", minimum: 0 },
              annualCostRate: { type: "number", minimum: 0, maximum: 100 },
            },
            additionalProperties: true,
          },
          ItemDetail: {
            type: "object",
            required: ["item", "quote", "seoInfo"],
            properties: {
              item: { $ref: "#/components/schemas/Item" },
              quote: { $ref: "#/components/schemas/ItemQuote" },
              seoInfo: { $ref: "#/components/schemas/SeoInfo" },
            },
            additionalProperties: true,
          },
          SeoInfo: {
            type: "object",
            properties: {
              title: { type: "string", maxLength: 200 },
              metaDescription: { type: "string", maxLength: 1000 },
              headingTitle: { type: "string", maxLength: 200 },
              image: { type: "string", maxLength: 500 },
              imageAlt: { type: "string", maxLength: 300 },
              imageWidth: { type: "integer", minimum: 1, maximum: 10000 },
              imageHeight: { type: "integer", minimum: 1, maximum: 10000 },
              friendlyUrl: { type: "string", maxLength: 2048 },
              noindex: { type: "boolean" },
              nofollow: { type: "boolean" },
              openGraphType: { type: "string", enum: ["website", "article", "product"] },
              publishedTime: { type: "string" },
              modifiedTime: { type: "string" },
            },
            additionalProperties: true,
          },
          ItemFacet: {
            type: "object",
            required: ["value", "count"],
            properties: {
              value: { type: "string", maxLength: 60 },
              count: { type: "integer", minimum: 0 },
            },
            additionalProperties: true,
          },
          ItemPage: {
            type: "object",
            required: ["items", "total", "page", "totalPages", "facets", "query", "seoInfo"],
            properties: {
              items: { type: "array", maxItems: 100, items: { $ref: "#/components/schemas/Item" } },
              total: { type: "integer", minimum: 0 },
              page: { type: "integer", minimum: 0 },
              totalPages: { type: "integer", minimum: 0 },
              facets: {
                type: "object",
                required: ["categories"],
                properties: {
                  categories: {
                    type: "array",
                    maxItems: 50,
                    items: { $ref: "#/components/schemas/ItemFacet" },
                  },
                },
                additionalProperties: true,
              },
              query: {
                type: "object",
                required: ["category", "sortBy"],
                properties: {
                  category: { type: "string", maxLength: 60 },
                  sortBy: { type: "string", maxLength: 60 },
                },
                additionalProperties: true,
              },
              seoInfo: { $ref: "#/components/schemas/SeoInfo" },
            },
            additionalProperties: true,
          },
          ItemReviews: {
            type: "object",
            required: ["reviews"],
            properties: {
              reviews: {
                type: "array",
                maxItems: 50,
                items: {
                  type: "object",
                  required: ["author", "rating", "comment"],
                  properties: {
                    author: { type: "string", maxLength: 120 },
                    rating: { type: "number", minimum: 1, maximum: 5 },
                    comment: { type: "string", maxLength: 2000 },
                  },
                  additionalProperties: true,
                },
              },
            },
            additionalProperties: true,
          },
          LiveMessage: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string", maxLength: 200 } },
            additionalProperties: true,
          },
          // Two levels, named separately: a self-referencing $ref is a cycle the
          // contract dereferencer cannot resolve, and the renderer bounds depth anyway.
          MenuLeaf: {
            type: "object",
            required: ["id", "name", "url", "displayOrder", "mobileDisplayOrder"],
            properties: {
              id: { type: "integer" },
              parentId: { type: ["integer", "null"] },
              name: { type: "string", maxLength: 120 },
              hamburgerName: { type: "string", maxLength: 120 },
              description: { type: "string", maxLength: 500 },
              url: { type: "string", maxLength: 2048 },
              external: { type: "boolean" },
              imagePath: { type: "string", maxLength: 500 },
              activeImagePath: { type: "string", maxLength: 500 },
              displayOrder: { type: "integer" },
              mobileDisplayOrder: { type: "integer" },
              menuType: { type: "integer" },
              itemType: { type: "integer" },
              menuDisplayDeviceType: { type: "integer" },
              menuDisplayType: { type: "integer" },
            },
            additionalProperties: true,
          },
          MenuItem: {
            type: "object",
            required: ["id", "name", "url", "displayOrder", "mobileDisplayOrder"],
            properties: {
              id: { type: "integer" },
              parentId: { type: ["integer", "null"] },
              name: { type: "string", maxLength: 120 },
              hamburgerName: { type: "string", maxLength: 120 },
              description: { type: "string", maxLength: 500 },
              url: { type: "string", maxLength: 2048 },
              external: { type: "boolean" },
              imagePath: { type: "string", maxLength: 500 },
              activeImagePath: { type: "string", maxLength: 500 },
              displayOrder: { type: "integer" },
              mobileDisplayOrder: { type: "integer" },
              menuType: { type: "integer" },
              itemType: { type: "integer" },
              menuDisplayDeviceType: { type: "integer" },
              menuDisplayType: { type: "integer" },
              subMenuItemList: {
                type: "array",
                maxItems: 50,
                items: { $ref: "#/components/schemas/MenuLeaf" },
              },
            },
            additionalProperties: true,
          },
          Menu: {
            type: "object",
            required: ["headerItems"],
            properties: {
              headerItems: {
                type: "array",
                maxItems: 50,
                items: { $ref: "#/components/schemas/MenuItem" },
              },
              hamburgerItems: {
                type: "array",
                maxItems: 50,
                items: { $ref: "#/components/schemas/MenuItem" },
              },
              footerItems: {
                type: "array",
                maxItems: 50,
                items: { $ref: "#/components/schemas/MenuItem" },
              },
            },
            additionalProperties: true,
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
          request: {
            method: "GET",
            path: "/items?category=all&sortBy=recommended&page=1&perPage=3",
          },
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
          request: { method: "GET", path: "/items/konut-avantaj" },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/item.json",
            schema: "#/components/schemas/ItemDetail",
          },
        },
        {
          id: "item-reviews",
          operationId: "catalog.reviews",
          request: { method: "GET", path: "/items/konut-avantaj/reviews" },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/item-reviews.json",
            schema: "#/components/schemas/ItemReviews",
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
          request: { method: "GET", path: "/pages/menuitem/list" },
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
  slug: "konut-avantaj",
  name: "Konut Avantaj",
  blurb: "Uzun vadeli konut finansmanı.",
  category: "konut",
  provider: "Örnek Bank",
  interestRate: 2.79,
  minAmount: 50_000,
  maxAmount: 5_000_000,
  terms: [12, 24, 36, 48, 60],
  seo: { title: "Konut Avantaj", description: "Konut Avantaj kredisi detayları." },
};
const gatewayItemsPageFixture = () =>
  JSON.stringify(
    {
      items: [fixtureItem],
      total: 7,
      page: 1,
      totalPages: 3,
      facets: {
        categories: [
          { value: "all", count: 7 },
          { value: "tools", count: 3 },
          { value: "materials", count: 2 },
          { value: "services", count: 2 },
        ],
      },
      query: { category: "all", sortBy: "recommended" },
      seoInfo: {
        title: "Katalog",
        metaDescription: "Katalog sayfası.",
        headingTitle: "Katalog",
        friendlyUrl: "/catalog",
        noindex: false,
        nofollow: false,
        openGraphType: "website",
      },
    },
    null,
    2,
  ) + "\n";
const gatewayReviewsFixture = () =>
  JSON.stringify(
    { reviews: [{ author: "Deniz", rating: 5, comment: "Süreç beklediğimden hızlı ilerledi." }] },
    null,
    2,
  ) + "\n";
const gatewayItemFixture = () =>
  JSON.stringify(
    {
      item: fixtureItem,
      quote: {
        amount: 100_000,
        term: 36,
        monthlyPayment: 4_649,
        totalPayment: 167_364,
        annualCostRate: 33.48,
      },
      seoInfo: {
        title: "Konut Avantaj",
        metaDescription: "Konut Avantaj kredisi detayları.",
        headingTitle: "Konut Avantaj",
        image: "/assets/images/og-cover.svg",
        imageAlt: "Konut Avantaj kapak görseli",
        imageWidth: 1200,
        imageHeight: 630,
        friendlyUrl: "/items/konut-avantaj",
        noindex: false,
        nofollow: false,
        openGraphType: "product",
      },
    },
    null,
    2,
  ) + "\n";
const gatewayLiveMessageFixture = () =>
  JSON.stringify({ message: "2026-01-01T00:00:00.000Z" }, null, 2) + "\n";
const gatewayMenuFixture = () =>
  JSON.stringify(
    {
      headerItems: [
        {
          id: 3,
          name: "Ürünler",
          url: "/catalog",
          displayOrder: 3,
          mobileDisplayOrder: 3,
          itemType: 4,
          subMenuItemList: [
            {
              id: 31,
              parentId: 3,
              name: "Tüm katalog",
              url: "/catalog",
              displayOrder: 1,
              mobileDisplayOrder: 1,
              itemType: 4,
            },
          ],
        },
      ],
      footerItems: [
        {
          id: 100,
          name: "İletişim",
          url: "/contact",
          displayOrder: 1,
          mobileDisplayOrder: 1,
          itemType: 16,
        },
      ],
    },
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
import { fetchSitemapEntries } from "@server/services/sitemap";
import type { Hono } from "hono";

/**
 * robots.txt and sitemap.xml. The platform owns the mechanics — headers,
 * caching, XML escaping, degradation — and this file owns the content: which
 * URLs exist, and what to serve when the source cannot answer.
 */
export function mountSeo(app: Hono<{ Variables: AppVariables }>): void {
  mountPlatformSeoRoutes(app, {
    siteUrl: config.siteUrl,
    entries: (request) => fetchSitemapEntries(request),
    // Served when the gateway is down: a stale sitemap beats no sitemap, and an
    // empty one tells a crawler this site has nothing on it.
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

const cachePurgeApiTest =
  () => `import { mountCachePurgeApi } from "@originloom/core/api/cache-purge";
import { initCache } from "@originloom/core/cache";
import { createMetricsApp } from "@originloom/core/metrics-server";
import { installProductRuntime } from "@server/product/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SECRET = "correct-horse-battery-staple";

function operations() {
  // The same wiring as server/index.ts: purge lives on the operations listener,
  // never on the public site.
  return createMetricsApp({ mounts: (app) => mountCachePurgeApi(app, { secret: SECRET }) });
}

function purge(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://ops.local/api/internal/cache/purge", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("the cache purge endpoints", () => {
  beforeEach(async () => {
    // The page-id allowlist lives in this app's cache registry, which the
    // platform reads through the runtime.
    installProductRuntime();
    await initCache();
  });
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it("is not reachable from the public site", async () => {
    const { routes } = await import("@server/routes");
    const { mountApi } = await import("@server/api");
    const { createApp } = await import("@originloom/core/app");

    const app = createApp({
      assets: { js: "/assets/entry.client.js", css: [], fonts: [] },
      routes,
      readinessCheck: async () => true,
      mounts: { api: mountApi },
    });
    const response = await app.request("http://app.local/api/internal/cache/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    // Emptying the cache points the whole fleet at the gateway. That button does
    // not belong on a port the internet can reach.
    expect(response.status).toBe(404);
  });

  it("rejects a wrong token", async () => {
    const response = await operations().request(
      purge({ pageIds: ["catalog"] }, { authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
  });

  it("accepts the token from either header", async () => {
    const bearer = await operations().request(
      purge({ pageIds: ["catalog"] }, { authorization: \`Bearer \${SECRET}\` }),
    );
    const custom = await operations().request(
      purge({ pageIds: ["catalog"] }, { "x-cache-purge-token": SECRET }),
    );

    expect(bearer.status).toBe(200);
    expect(custom.status).toBe(200);
  });

  it("refuses a page id this app does not have", async () => {
    const response = await operations().request(
      purge({ pageIds: ["not-a-page"] }, { "x-cache-purge-token": SECRET }),
    );

    // The registry in src/lib/cache-keys.ts is the allowlist: purging by page id
    // can only name a page this app actually caches.
    expect(response.status).toBe(400);
  });
});

`;

const webhookApi = () => `import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "@originloom/core/config";
import { logger } from "@originloom/core/logger";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { isRecord } from "@originloom/shared/lib/runtime-schema";
import type { Hono } from "hono";

/**
 * An endpoint the internet can reach, which acts on what it is told.
 *
 * Everything here is about the gap between "a request arrived" and "the provider
 * sent it". Four separate things have to hold, and each one is a real incident
 * when it does not:
 *
 * 1. **Signature** over the *raw* body. Verifying a re-serialized object checks
 *    your own JSON encoder, not the sender.
 * 2. **Timestamp window.** A valid signature stays valid forever; without a
 *    window, a captured request can be replayed a year later.
 * 3. **Idempotency.** Providers retry, and a retry that is processed twice is a
 *    duplicate payment, a duplicate application, a duplicate email.
 * 4. **A bounded read.** An unbounded body on an unauthenticated endpoint is a
 *    memory-exhaustion button.
 *
 * The signature scheme is the provider's, not this app's — check theirs before
 * copying this one.
 */
const MAX_BODY_BYTES = 64 * 1024;
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const SEEN_MAX_ENTRIES = 5_000;

/** Ids already processed, with the time they may be forgotten. Bounded on purpose. */
const seen = new Map<string, number>();

export async function handleProviderWebhook(request: Request): Promise<Response> {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    // Failing closed: without a secret nothing here can tell the provider from
    // anyone else, and an open webhook is a way to write to your system.
    logger.error("webhook secret is not configured — refusing to accept deliveries");
    return refuse(503, "not_configured");
  }

  const signature = request.headers.get("x-signature");
  const timestamp = Number(request.headers.get("x-timestamp"));
  if (!signature || !Number.isFinite(timestamp)) return refuse(400, "missing_signature");

  // The window is checked before the HMAC so a flood of stale replays costs a
  // comparison rather than a hash over 64 KB.
  const age = Math.abs(Date.now() - timestamp);
  if (age > REPLAY_WINDOW_MS) return refuse(400, "stale_timestamp");

  const raw = await readBounded(request);
  if (raw === null) return refuse(413, "body_too_large");

  // The signature covers timestamp *and* body: signing the body alone would let
  // a captured delivery be re-sent with a fresh timestamp.
  const expected = createHmac("sha256", secret).update(\`\${timestamp}.\${raw}\`).digest("hex");
  if (!constantTimeEquals(signature, expected)) return refuse(401, "bad_signature");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return refuse(400, "invalid_json");
  }
  if (!isRecord(payload) || typeof payload.id !== "string" || payload.id.length > 200) {
    return refuse(400, "invalid_payload");
  }

  // A retry is the provider doing its job. Answering 200 without acting again is
  // the only correct response to one.
  if (rememberOnce(payload.id) === "already-seen") {
    return accept({ status: "duplicate" });
  }

  logger.info("webhook accepted", { id: payload.id, event: String(payload.event ?? "unknown") });
  // Nothing slow here: the provider is holding a connection open and will retry
  // on a timeout. Hand the work to a queue and answer.
  return accept({ status: "accepted" });
}

export function mountWebhookApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/webhooks/provider", (c) => {
    c.set("requestRoute", "<api webhook>");
    return handleProviderWebhook(contextRequest(c));
  });
}

/** Reads at most \`MAX_BODY_BYTES\`; returns null when the sender exceeds it. */
async function readBounded(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    // Content-Length is the sender's claim; this is the check.
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, size));
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Constant-time, and length-safe.
 *
 * \`timingSafeEqual\` throws on a length mismatch, and returning early on one
 * leaks the expected length — so both sides are hashed to a fixed width first.
 */
function constantTimeEquals(candidate: string, expected: string): boolean {
  const digest = (value: string) => createHmac("sha256", "compare").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

/** @returns \`"already-seen"\` when this delivery was processed before. */
function rememberOnce(id: string): "new" | "already-seen" {
  const now = Date.now();
  const until = seen.get(id);
  if (until !== undefined && until > now) return "already-seen";

  // Bounded: an unbounded set of ids on a public endpoint is a slow memory leak
  // with a sender who controls its rate.
  if (seen.size >= SEEN_MAX_ENTRIES) {
    for (const [key, expiry] of seen) {
      if (expiry <= now) seen.delete(key);
    }
    if (seen.size >= SEEN_MAX_ENTRIES) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }
  seen.set(id, now + REPLAY_WINDOW_MS * 2);
  return "new";
}

function refuse(status: 400 | 401 | 413 | 503, reason: string): Response {
  // The reason is for your logs, not for whoever is probing: it says what was
  // wrong with the request, never what the expected value was.
  logger.warn("webhook refused", { reason, status });
  return json({ error: reason }, status);
}

function accept(body: Record<string, string>): Response {
  return json(body, 202);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

/** Exported for tests only: the seen-id table is process state. */
export function resetWebhookState(): void {
  if (!config.isProduction) seen.clear();
}
`;

const webhookApiTest = () => `import { createHmac } from "node:crypto";

import { handleProviderWebhook, resetWebhookState } from "@server/api/webhooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@originloom/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SECRET = "correct-horse-battery-staple";

function delivery(
  body: unknown,
  options: { timestamp?: number; signature?: string; secret?: string } = {},
): Request {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? Date.now();
  const signature =
    options.signature ??
    createHmac("sha256", options.secret ?? SECRET).update(\`\${timestamp}.\${raw}\`).digest("hex");
  return new Request("http://app.local/api/webhooks/provider", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
      "x-timestamp": String(timestamp),
    },
    body: raw,
  });
}

describe("the provider webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = SECRET;
    resetWebhookState();
  });
  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
  });

  it("accepts a correctly signed delivery", async () => {
    const response = await handleProviderWebhook(delivery({ id: "evt-1", event: "approved" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "accepted" });
  });

  it("refuses a body signed with the wrong secret", async () => {
    const response = await handleProviderWebhook(
      delivery({ id: "evt-2" }, { secret: "not-the-secret" }),
    );

    expect(response.status).toBe(401);
  });

  it("refuses a body that changed after it was signed", async () => {
    const timestamp = Date.now();
    const signature = createHmac("sha256", SECRET)
      .update(\`\${timestamp}.\${JSON.stringify({ id: "evt-3", amount: 10 })}\`)
      .digest("hex");

    // The signature covers the raw bytes. Verifying a re-serialized object would
    // check this app's JSON encoder rather than the sender.
    const response = await handleProviderWebhook(
      delivery({ id: "evt-3", amount: 1_000_000 }, { timestamp, signature }),
    );

    expect(response.status).toBe(401);
  });

  it("refuses a delivery older than the replay window", async () => {
    // A valid signature stays valid forever; the window is what stops a captured
    // request from being replayed next year.
    const response = await handleProviderWebhook(
      delivery({ id: "evt-4" }, { timestamp: Date.now() - 10 * 60 * 1000 }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "stale_timestamp" });
  });

  it("answers a retry without acting on it twice", async () => {
    const first = await handleProviderWebhook(delivery({ id: "evt-5", event: "approved" }));
    const retry = await handleProviderWebhook(delivery({ id: "evt-5", event: "approved" }));

    // Providers retry. A retry processed twice is a duplicate payment, a
    // duplicate application, a duplicate email.
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toEqual({ status: "accepted" });
    await expect(retry.json()).resolves.toEqual({ status: "duplicate" });
  });

  it("refuses a body larger than the limit", async () => {
    const huge = { id: "evt-6", note: "x".repeat(100 * 1024) };

    // An unbounded read on an endpoint the internet can reach is a
    // memory-exhaustion button.
    expect((await handleProviderWebhook(delivery(huge))).status).toBe(413);
  });

  it("refuses everything when no secret is configured", async () => {
    delete process.env.WEBHOOK_SECRET;

    // Failing closed: without a secret this endpoint cannot tell the provider
    // from anyone else, and an open webhook is a way to write to your system.
    expect((await handleProviderWebhook(delivery({ id: "evt-7" }))).status).toBe(503);
  });

  it("never says what the expected signature was", async () => {
    const response = await handleProviderWebhook(delivery({ id: "evt-8" }, { signature: "nope" }));

    const body = await response.text();
    expect(body).not.toMatch(/[0-9a-f]{64}/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
`;

const referralService = () => `import {
  gatewayFetchWithIdentity,
  releaseGatewayResponse,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

const INVALID = "Referral gateway returned an invalid payload";

/**
 * What the provider gives back when a visitor is sent to them: where to go, and
 * the id that ties the visit to this site when they convert.
 */
export type Referral = { redirectUrl: string; referralId: string };

/**
 * Records the hand-off and asks for the destination.
 *
 * The destination is not built here and not stored in this app: it belongs to
 * the provider, may carry a one-time token, and changes without a deploy. The
 * anonymous session id is what makes a returning visitor the same visitor
 * without knowing anything about them.
 */
export async function createReferral(
  slug: string,
  anonymousSessionId: string,
  request: Request,
): Promise<Referral | null> {
  const response = await gatewayFetchWithIdentity(request, "/referrals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug, anonymousSessionId }),
  });
  // An unknown product is data, not a failure — the endpoint turns it into a 404.
  if (response.status === 400 || response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  await requireGatewayOk(response, "Referral gateway returned");

  const payload = await readGatewayJson(response, GatewayContracts.referral, INVALID);
  return requireGatewayPayload(GatewayContracts.referral, payload, isReferral, INVALID);
}

function isReferral(value: unknown): value is Referral {
  return (
    isRecord(value) && isBoundedString(value.redirectUrl, 2_048) && isBoundedString(value.referralId, 120)
  );
}
`;

const referralApi = () => `import { config } from "@originloom/core/config";
import { applyCookies, CookieJar } from "@originloom/core/middleware/cookie-jar";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { sanitizeUuid } from "@originloom/core/middleware/sanitize";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { normalizeNavigationUrl } from "@originloom/shared/lib/content-url";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { Cookie } from "@originloom/shared/lib/cookies";
import { cookie } from "@originloom/shared/lib/request";
import { createReferral } from "@server/services/referrals";
import type { Hono } from "hono";

const REFERRAL_SESSION_MAX_AGE = 86_400 * 30;

/**
 * Sending a visitor to the provider is a write.
 *
 * It records something, it sets a cookie, and it must not happen because a
 * crawler followed a link or a page was prefetched — so it is a POST from a
 * form, same-origin checked and rate limited, and the answer is a 303 that the
 * browser will not repeat on refresh.
 */
const REFERRAL_POLICY: PublicApiPolicy = {
  name: "referral",
  windowMs: 60_000,
  globalLimit: 1_000,
  ipLimit: 30,
  requireSameOriginMutation: true,
};

export async function handleReferral(request: Request, clientIp = "unresolved"): Promise<Response> {
  const denied = await guardPublicApi(request, clientIp, REFERRAL_POLICY);
  if (denied) return denied;

  const form = await readForm(request);
  const slug = form?.get("slug");
  if (typeof slug !== "string" || !isBoundedRouteSlug(slug)) {
    return refuse("Geçersiz başvuru isteği", 400);
  }

  // The same visitor across visits, without knowing who they are: a random id in
  // an HttpOnly cookie. It never reaches the page, so it cannot leak into cached
  // HTML, and it is not a login.
  const currentSession = sanitizeUuid(cookie(request, Cookie.referralSession));
  const anonymousSessionId = currentSession ?? crypto.randomUUID();

  const referral = await createReferral(slug, anonymousSessionId, request);
  if (!referral) return refuse("Ürün bulunamadı", 404);

  // The provider's URL is still untrusted input. \`external: true\` allows a
  // cross-origin destination but still rejects javascript:, data: and anything
  // that is not an absolute https URL — an open redirect is what this prevents.
  const destination = normalizeNavigationUrl(referral.redirectUrl, {
    siteUrl: config.siteUrl,
    external: true,
  });
  if (!destination) return refuse("Güvenli yönlendirme oluşturulamadı", 502);

  const response = new Response(null, {
    status: 303,
    headers: { location: destination, "cache-control": "private, no-store" },
  });
  if (currentSession) return response;

  const cookies = new CookieJar();
  cookies.set(Cookie.referralSession, anonymousSessionId, {
    httpOnly: true,
    secure: config.isProduction,
    // Lax, not Strict: the visitor comes back from the provider through a
    // cross-site navigation, and the session has to survive that.
    sameSite: "lax",
    maxAge: REFERRAL_SESSION_MAX_AGE,
  });
  return applyCookies(response, cookies);
}

export function mountReferralApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/referrals", (c) => {
    c.set("requestRoute", "<api referral>");
    return handleReferral(contextRequest(c), c.get("clientIp") ?? "unresolved");
  });
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function refuse(message: string, status: 400 | 404 | 502): Response {
  return new Response(message, { status, headers: { "cache-control": "private, no-store" } });
}
`;

const referralApiTest = () => `import { handleReferral } from "@server/api/referrals";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const ORIGIN = "http://localhost:3000";

function submit(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(\`\${ORIGIN}/api/referrals\`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // Fetch Metadata is what the guard reads first; an Origin header only
      // matters for the browsers that do not send it.
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
      ...headers,
    },
    body: new URLSearchParams(fields),
  });
}

function upstream(body: unknown, status = 200) {
  mocks.gatewayFetchWithIdentity.mockImplementation(
    async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("leaving for the provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upstream({ redirectUrl: "https://provider.example/apply?ref=abc", referralId: "ref-1" });
  });

  it("redirects with a 303 so a refresh does not record a second hand-off", async () => {
    const response = await handleReferral(submit({ slug: "konut-avantaj" }), "203.0.113.9");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://provider.example/apply?ref=abc");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("mints an anonymous session the visitor keeps, and never shows it to the page", async () => {
    const response = await handleReferral(submit({ slug: "konut-avantaj" }), "203.0.113.9");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^referral_session=/);
    // HttpOnly: the id identifies a returning visitor to the server and to
    // nothing else. Script-readable, it would be one more thing to leak.
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("reuses the session the visitor already has", async () => {
    const existing = "9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b";
    const response = await handleReferral(
      submit({ slug: "konut-avantaj" }, { cookie: \`referral_session=\${existing}\` }),
      "203.0.113.9",
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    const sent = JSON.parse(
      (mocks.gatewayFetchWithIdentity.mock.calls[0]?.[2] as { body: string }).body,
    ) as { anonymousSessionId: string };
    // Repeat clicks are counted; the visitor behind them stays one visitor.
    expect(sent.anonymousSessionId).toBe(existing);
  });

  it("refuses a destination that is not a safe absolute URL", async () => {
    upstream({ redirectUrl: "javascript:alert(1)", referralId: "ref-1" });

    // The provider's URL is untrusted input. Following it blindly is an open
    // redirect with this site's name on it.
    const response = await handleReferral(submit({ slug: "konut-avantaj" }), "203.0.113.9");

    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
  });

  it("refuses a cross-site submission", async () => {
    const response = await handleReferral(
      submit({ slug: "konut-avantaj" }, { "sec-fetch-site": "cross-site" }),
      "203.0.113.9",
    );

    expect(response.status).toBe(403);
    expect(mocks.gatewayFetchWithIdentity).not.toHaveBeenCalled();
  });

  it("refuses a slug that was never a slug", async () => {
    const response = await handleReferral(submit({ slug: "../../etc/passwd" }), "203.0.113.9");

    expect(response.status).toBe(400);
    expect(mocks.gatewayFetchWithIdentity).not.toHaveBeenCalled();
  });

  it("reports an unknown product as a 404 rather than a broken redirect", async () => {
    upstream({ error: "not_found" }, 404);

    const response = await handleReferral(submit({ slug: "yok-boyle-bir-urun" }), "203.0.113.9");

    expect(response.status).toBe(404);
  });
});
`;

const publicItemsApi =
  () => `import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { listItems } from "@server/services/items";
import type { Hono } from "hono";

import { itemsQuery } from "~/lib/catalog-query";

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

    const { items, total } = await listItems(itemsQuery({ perPage: 20 }), request);
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
      await submitEnquiry(enquiry, request);
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

const enquiryService = () => `import {
  gatewayFetchWithIdentity,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import { GatewayContracts } from "./gateway-contracts";

export type Enquiry = { name: string; email: string; message: string };
export type EnquiryReceipt = { id: string };

const INVALID = "Enquiry gateway returned an invalid payload";

/** The endpoint owns validation; this owns the upstream call and its contract. */
export async function submitEnquiry(
  enquiry: Enquiry,
  request: Request,
): Promise<EnquiryReceipt> {
  const response = await gatewayFetchWithIdentity(request, "/enquiries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(enquiry),
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
    expect(mocks.submitEnquiry).toHaveBeenCalledWith(valid, expect.any(Request));
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

const noCacheRoute = () => `import { defineRoute } from "@originloom/react/lib/types";
import { neverCache } from "@originloom/shared/lib/cache-policy";
import { listItems } from "@server/services/items";

import { NoCachePage } from "~/features/no-cache/no-cache-page";
import { itemsQuery } from "~/lib/catalog-query";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = {
  items: { slug: string; name: string }[];
  renderedAt: string;
  gatewayMs: number;
};

/**
 * The baseline: nothing is cached anywhere.
 *
 * The document is rendered per request (\`neverCache\`) and the loader calls the
 * gateway directly rather than through a cached snapshot, so every visitor costs
 * one upstream round trip. It exists to be measured against — the same list is
 * served by /catalog through the HTML cache and by /data-cache through a cached
 * upstream snapshot, and the difference between the three is the whole argument
 * for the cache layer.
 *
 * A real page rarely wants this. Two that do: anything whose value is that it is
 * never stale (a live balance, a stock count read at the moment of the visit),
 * and anything whose HTML is different for every visitor and cannot be moved
 * into an island.
 */
export default defineRoute<Data>({
  path: "/no-cache",
  cache: neverCache,
  loader: async (ctx) => {
    const startedAt = performance.now();
    const { items } = await listItems(itemsQuery({ perPage: 5 }), ctx.request);
    return {
      data: {
        items: items.map((item) => ({ slug: item.slug, name: item.name })),
        renderedAt: new Date().toISOString(),
        gatewayMs: Math.round(performance.now() - startedAt),
      },
    };
  },
  generateMetadata: () => ({
    title: "Cache'siz sayfa",
    description: "Ne doküman ne de veri cache'lenir; her istek gateway'e gider.",
    // Nothing here is worth indexing, and a page that costs an upstream call per
    // request is a page a crawler should not be walking.
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "no-cache"),
  Component: NoCachePage,
});
`;

const noCachePage = () => `import { Link } from "@originloom/react/lib/link";

type Props = {
  data: { items: { slug: string; name: string }[]; renderedAt: string; gatewayMs: number };
};

/**
 * Every value on this page is per request. Reload it and the timestamp changes;
 * reload /catalog and it does not until its TTL expires.
 */
export function NoCachePage({ data }: Props) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Cache'siz sayfa</h1>
        <p className="max-w-2xl text-slate-600">
          Bu sayfada doküman cache'i de upstream veri cache'i de kapalı. Her istek bir gateway
          çağrısı demek — karşılaştırmak için <Link href="/catalog">/catalog</Link> (HTML cache) ve{" "}
          <Link href="/data-cache">/data-cache</Link> (veri cache'i) sayfalarını da yenileyin.
        </p>
      </header>

      <dl className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-slate-500">Render zamanı</dt>
          <dd className="font-mono text-sm text-slate-900">{data.renderedAt}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Gateway süresi</dt>
          <dd className="font-mono text-sm text-slate-900">{data.gatewayMs} ms</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Cache</dt>
          <dd className="font-mono text-sm text-slate-900">yok (x-cache: BYPASS)</dd>
        </div>
      </dl>

      <ul className="divide-y divide-slate-100">
        {data.items.map((item) => (
          <li key={item.slug} className="py-3">
            <Link className="font-medium text-slate-800 hover:underline" href={"/items/" + item.slug}>
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
`;

const detailSeoTest = () => `import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { installProductRuntime } from "@server/product/runtime";
import { routes } from "@server/routes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const item = {
  slug: "alpha",
  name: "Alpha",
  blurb: "İlk örnek kayıt.",
  category: "ihtiyac",
  provider: "Örnek Bank",
  interestRate: 3.1,
  minAmount: 10_000,
  maxAmount: 500_000,
  terms: [12, 24, 36],
  seo: { title: "Alpha", description: "Alpha detay sayfası." },
};
const quote = {
  amount: 100_000,
  term: 36,
  monthlyPayment: 4_200,
  totalPayment: 151_200,
  annualCostRate: 37.2,
};
const seoInfo = {
  title: "Alpha — CMS başlığı",
  metaDescription: "CMS açıklaması.",
  headingTitle: "Alpha",
  image: "/assets/images/og-cover.svg",
  imageAlt: "Alpha kapak görseli",
  friendlyUrl: "/items/alpha",
  noindex: false,
  nofollow: false,
  openGraphType: "product",
};

function respond(path: string) {
  if (path.endsWith("/reviews")) {
    return Response.json({ reviews: [{ author: "Deniz", rating: 5, comment: "iyi" }] });
  }
  return Response.json({ item, quote, seoInfo });
}

async function render(path: string): Promise<string> {
  const app = createApp({
    assets: { js: "/assets/entry.client.js", css: [], fonts: [] },
    routes,
    readinessCheck: async () => true,
  });
  return (await app.request(\`http://app.local\${path}\`)).text();
}

function structuredData(html: string): Record<string, unknown>[] {
  const block = /<script type="application\\/ld\\+json"[^>]*>(.*?)<\\/script>/s.exec(html);
  if (!block) return [];
  const parsed = JSON.parse(block[1] ?? "{}") as { "@graph"?: Record<string, unknown>[] };
  return parsed["@graph"] ?? [];
}

describe("the detail page's SEO output", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.gatewayFetchWithIdentity.mockImplementation(async (_r: Request, p: string) => respond(p));
    installProductRuntime();
    await closeCache();
    await initCache();
  });
  afterEach(async () => {
    await closeCache();
  });

  it("actually emits the structured data the route builds", async () => {
    const nodes = structuredData(await render("/items/alpha"));

    // The field is \`structuredData\`. A route that returns \`jsonLd\` type-checks,
    // renders, and silently ships a page with no breadcrumb on it — which is why
    // this test reads the HTML rather than the route's return value.
    expect(nodes.map((node) => node["@type"])).toContain("BreadcrumbList");
    expect(nodes.map((node) => node["@type"])).toContain("FinancialProduct");
  });

  it("takes its title, description and social image from the CMS", async () => {
    const html = await render("/items/alpha");

    expect(html).toContain("Alpha — CMS başlığı");
    expect(html).toContain("CMS açıklaması.");
    // og:image and its alt text are the fields a hand-written metadata block
    // always forgets, and the ones that decide what a shared link looks like.
    expect(html).toMatch(/property="og:image"/);
    expect(html).toContain("Alpha kapak görseli");
  });

  it("keeps the route's own address as the canonical one", async () => {
    const html = await render("/items/alpha");

    expect(html).toMatch(/<link rel="canonical" href="[^"]*\\/items\\/alpha"/);
  });

  it("obeys a noindex the CMS set", async () => {
    mocks.gatewayFetchWithIdentity.mockImplementation(async (_r: Request, p: string) =>
      p.endsWith("/reviews")
        ? Response.json({ reviews: [] })
        : Response.json({ item, quote, seoInfo: { ...seoInfo, noindex: true } }),
    );

    const html = await render("/items/alpha");

    // Whether a page belongs in the index is an editorial decision, so it is
    // made where the copy is made.
    expect(html).toMatch(/name="robots"[^>]*noindex/);
  });
});
`;

const quoteQueryTest = () => `import { routes } from "@server/routes";
import { describe, expect, it } from "vitest";

import { PageCacheId, pageCacheRegistry } from "~/lib/cache-keys";
import { DEFAULT_AMOUNT, quoteHref, quoteNormalizers, quoteSearch } from "~/lib/quote-query";

function url(query: string): URL {
  return new URL(\`http://app.local/items/konut-avantaj\${query}\`);
}

describe("the quote query contract", () => {
  it("clamps and rounds an amount instead of rejecting it", () => {
    // A visitor typing a number should get a quote, not a 404 — and rounding to a
    // step is what stops a slider from turning one page into ten thousand cache
    // entries.
    expect(quoteSearch(url("?amount=123456")).get("amount")).toBe("123000");
    expect(quoteSearch(url("?amount=1")).get("amount")).toBe("10000");
    expect(quoteSearch(url("?amount=99999999")).get("amount")).toBe("5000000");
    expect(quoteSearch(url("?amount=abc")).get("amount")).toBe(String(DEFAULT_AMOUNT));
  });

  it("falls back to a term the product actually offers", () => {
    expect(quoteSearch(url("?term=36")).get("term")).toBe("36");
    expect(quoteSearch(url("?term=7")).get("term")).toBe("36");
  });

  it("keeps everything else out of the gateway request", () => {
    const search = quoteSearch(url("?amount=50000&term=24&utm_source=x&gclid=y"));

    expect([...search.keys()]).toEqual(["amount", "term"]);
  });

  it("uses the same normalizers for the cache key as for the request", () => {
    const contentQuery = pageCacheRegistry[PageCacheId.itemDetail].contentQuery;

    expect(contentQuery?.include).toEqual(["amount", "term"]);
    expect(contentQuery?.normalize).toBe(quoteNormalizers);
  });

  it("drops defaults so the product keeps one address", () => {
    expect(quoteHref("konut-avantaj", new URLSearchParams("amount=100000&term=36"), {})).toBe(
      "/items/konut-avantaj",
    );
    expect(quoteHref("konut-avantaj", new URLSearchParams(), { amount: "250000" })).toBe(
      "/items/konut-avantaj?amount=250000",
    );
  });

  it("keeps the product's canonical free of the quote", () => {
    const route = routes.find((entry) => entry.path === "/items/:slug");
    const metadata = route?.generateMetadata?.(
      {
        item: { slug: "konut-avantaj", name: "Konut Avantaj", blurb: "b", category: "konut", provider: "Örnek Bank", interestRate: 2.79, minAmount: 50_000, maxAmount: 5_000_000, terms: [36], seo: { title: "t", description: "d" } },
        quote: { amount: 250_000, term: 36, monthlyPayment: 1, totalPayment: 2, annualCostRate: 3 },
        seoInfo: { friendlyUrl: "/items/konut-avantaj" },
        reviews: [],
      } as never,
      { url: url("?amount=250000"), publicPath: "/items/konut-avantaj", siteUrl: "https://app.local" } as never,
    );

    // The amount is a view of one page, not a page of its own. Letting it into
    // the canonical would publish a separate URL for every slider position.
    expect(metadata?.canonical).toBe("https://app.local/items/konut-avantaj");
  });
});
`;

const catalogQueryTest = () => `import { routes } from "@server/routes";
import { describe, expect, it } from "vitest";

import { PageCacheId, pageCacheRegistry } from "~/lib/cache-keys";
import {
  CATALOG_QUERY,
  catalogHref,
  catalogNormalizers,
  catalogSearch,
} from "~/lib/catalog-query";

const catalogRoute = routes.find((route) => route.path === "/catalog");

function url(query: string): URL {
  return new URL(\`http://app.local/catalog\${query}\`);
}

describe("the catalog query contract", () => {
  it("sends the gateway only allowlisted, normalized values", () => {
    const search = catalogSearch(url("?category=konut&sortBy=newest&utm_source=x&page=3"), 12);

    expect(search.get("category")).toBe("konut");
    expect(search.get("sortBy")).toBe("newest");
    expect(search.get("page")).toBe("3");
    expect(search.get("perPage")).toBe("12");
    // A tracking param reaches neither the gateway nor the cache key. If it did,
    // every campaign link would be its own cache entry of identical HTML.
    expect(search.has("utm_source")).toBe(false);
  });

  it("treats an unknown filter value as the default rather than an error", () => {
    const search = catalogSearch(url("?category=nonsense&sortBy=nonsense"), 12);

    expect(search.get("category")).toBe("all");
    expect(search.get("sortBy")).toBe("recommended");
  });

  it("uses the same normalizers for the cache key as for the request", () => {
    const contentQuery = pageCacheRegistry[PageCacheId.catalog].contentQuery;

    // Two copies of this rule is how ?sortBy=newest ends up serving the cached
    // HTML of ?sortBy=recommended.
    expect(contentQuery?.include).toEqual([...CATALOG_QUERY]);
    expect(contentQuery?.normalize).toBe(catalogNormalizers);
  });

  it("drops defaults from filter links so one page keeps one URL", () => {
    expect(catalogHref(new URLSearchParams("category=konut"), { category: "all" })).toBe("/catalog");
    expect(catalogHref(new URLSearchParams(), { category: "konut" })).toBe(
      "/catalog?category=konut",
    );
  });

  it("returns to the first page when the filter changes", () => {
    // Page 4 of "all" is rarely page 4 of "tools", and an empty page 4 reads as
    // "no results" rather than "you went too far".
    const href = catalogHref(new URLSearchParams("category=all&page=4"), { category: "konut" });

    expect(href).toBe("/catalog?category=konut");
  });

  it("keeps the filters when only the page changes", () => {
    const href = catalogHref(new URLSearchParams("category=konut&sortBy=newest"), { page: "2" });

    expect(href).toBe("/catalog?category=konut&sortBy=newest&page=2");
  });
});

describe("the catalog route", () => {
  it("does not cache a URL that is about to 404 or redirect", () => {
    // Caching those would let one bad link fill the cache with copies of an
    // error, each under a key no valid request will ever ask for.
    const invalid = catalogRoute?.cache?.({ url: url("?page=abc") } as never);
    const canonical = catalogRoute?.cache?.({ url: url("?page=1") } as never);

    expect(invalid).toEqual({ kind: "none" });
    expect(canonical).toEqual({ kind: "none" });
  });
});
`;

const itemDetailReviewsTest = () => `import { routes } from "@server/routes";
import { getItemReviews } from "@server/services/items";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gatewayFetchWithIdentity: vi.fn() }));
vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@originloom/core/adapters/gateway")>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

const request = new Request("http://app.local/items/alpha");

describe("the detail page's second gateway call", () => {
  it("is part of the cached document rather than streamed after it", () => {
    const route = routes.find((entry) => entry.path === "/items/:slug");

    // These two cannot both be true. A cache entry is the finished document, so
    // a route that is shared-cached has nothing to stream: the first visitor
    // pays for both halves and everyone else is served the whole thing at once.
    // The opposite trade is on /live, which is neverCache and streams.
    expect(route?.streaming).toBeFalsy();
    const policy = route?.cache?.({
      url: new URL("http://app.local/items/alpha"),
      params: { slug: "alpha" },
      request: new Request("http://app.local/items/alpha"),
    } as never);
    expect(policy).toMatchObject({ kind: "shared" });
  });

  it("costs the section, not the page, when the gateway cannot answer", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(new Response("", { status: 503 }));

    // Reviews are an addition to the page. Throwing here would turn a degraded
    // section into a 500 for a product that is perfectly renderable without it.
    await expect(getItemReviews("alpha", request)).resolves.toEqual([]);
  });

  it("rejects a review list the gateway got wrong", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(
      Response.json({ reviews: [{ author: "Deniz", rating: 11, comment: "" }] }),
    );

    // A rating of 11 is not a rating. Rendering it would put a broken star row
    // on the page and an impossible aggregateRating in the structured data.
    await expect(getItemReviews("alpha", request)).rejects.toThrow(/invalid payload/i);
  });
});

`;

const gatewayIdentityCoverageTest =
  () => `import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SERVER_ROOT = new URL("../server", import.meta.url).pathname;

/**
 * Calls that legitimately have no request behind them, with the reason.
 *
 * Every upstream call tells the gateway who asked, from where and on what:
 * \`gatewayFetchWithIdentity\` for shared reads, \`gatewayFetchForRequest\` when the
 * caller's credentials belong with it. Plain \`gatewayFetch\` is the only way to
 * reach the gateway without any of that, so this list is the whole set of calls
 * that go out anonymous — and each one has to say why.
 */
const IDENTITY_LESS_BY_DESIGN: Record<string, string> = {
  "services/bot-analytics.ts":
    "a background queue flushed after the request is gone; each event carries its own tracking id",
  "services/menu.ts":
    "one answer per device, shared by everyone on it — an id would name something the response cannot depend on",
  "middleware/redirect-rules.ts":
    "a property of the URL, not of the visitor; and it runs before-auth, where no identity exists yet",
  "services/route-domains.ts":
    "falls back to a bare call only when the snapshot is refreshed outside a request",
  "services/sitemap.ts": "falls back to a bare call only when built outside a request",
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry): string[] => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("gateway identity coverage", () => {
  it("keeps every upstream call identity-carrying unless it is on the list", () => {
    const offenders = sourceFiles(SERVER_ROOT)
      .filter((file) => /\\bgatewayFetch\\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SERVER_ROOT.length + 1))
      .filter((relative) => !(relative in IDENTITY_LESS_BY_DESIGN));

    // A new service that reaches for plain \`gatewayFetch\` either belongs on the
    // list above with a reason, or should be taking the Request and using
    // \`gatewayFetchWithIdentity\`.
    expect(offenders).toEqual([]);
  });
});
`;

const noCacheTest = () => `import { routes } from "@server/routes";
import { describe, expect, it } from "vitest";

import { pageCacheRegistry } from "~/lib/cache-keys";

describe("the zero-cache page", () => {
  it("is registered and rendered per request", () => {
    const route = routes.find((entry) => entry.path === "/no-cache");
    expect(route, "/no-cache must be in the route table").toBeDefined();

    // neverCache() takes no context, so the policy is the same for every request.
    expect(route?.cache?.({} as never)).toEqual({ kind: "none" });
  });

  it("stays out of the page cache registry", () => {
    // The registry is the list of pages that have a cache identity. A page with
    // no cache has nothing to identify, and adding one would give the purge API
    // a key that can never hold anything.
    expect(Object.keys(pageCacheRegistry)).not.toContain("no-cache");
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
