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
 * }} vars
 */
export function renderTemplates({ name, title, port, metricsPort, mode, version }) {
  // Standalone apps live in their own repo and depend on the published
  // @originloom/* packages; workspace apps sit in apps/<name> and link them
  // via workspace:*. The two modes differ only in how they reach the packages
  // and how they build — the app source they generate is identical.
  const standalone = mode === "standalone";
  return {
    "package.json": packageJson(name, { standalone, version }),
    "tsconfig.json": tsconfig(standalone),
    "eslint.config.js": eslintConfig(),
    ".prettierrc.json": asset("prettierrc.json"),
    ".prettierignore": prettierIgnore(),
    "vite.config.ts": viteConfig(),
    "vite.server.config.ts": viteServerConfig(),
    "vitest.config.ts": vitestConfig(name),
    ".env.development": envDevelopment(port, metricsPort),
    ".env.production": envProduction(port, metricsPort),
    "README.md": readme(name, title, port, standalone),
    Dockerfile: dockerfile(name, port, standalone),
    ".dockerignore": asset("dockerignore"),
    ".gitignore": asset("gitignore"),
    ".nvmrc": asset("nvmrc"),
    ".editorconfig": asset("editorconfig"),

    "server/index.ts": serverIndex(),
    "server/api/index.ts": apiIndex(),
    "server/routes/index.ts": routesIndex(),
    "server/routes/home.tsx": homeRoute(title),
    "server/routes/showcase.tsx": showcaseRoute(),
    "server/routes/catalog.tsx": catalogRoute(),
    "server/routes/item-detail.tsx": itemDetailRoute(),
    "server/routes/account.tsx": accountRoute(),
    "server/routes/live.tsx": liveRoute(),
    "server/services/shell-data.ts": serverShellData(),
    "server/services/items.ts": itemsService(),
    "server/product/runtime.ts": productRuntime(),
    "server/product/document-shell.tsx": productDocumentShell(title),
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
const packageJson = (name, { standalone, version }) => {
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
        dev: "origin-dev",
        build: "origin-build",
        start: "origin-run-with-env production node --enable-source-maps dist/server/index.js",
        "start:dev": "origin-run-with-env development node --import tsx/esm server/index.ts",
        smoke: "origin-smoke",
        typecheck: "tsc --noEmit",
        "check:cycles": "origin-check-cycles",
        lint: "eslint .",
        "lint:fix": "eslint . --fix",
        format: "prettier --write .",
        "format:check": "prettier --check .",
        test: "vitest run",
      },
      dependencies: {
        "@hono/node-server": "^1.13.7",
        "@originloom/core": originloom,
        "@originloom/react": originloom,
        "@originloom/shared": originloom,
        "@tailwindcss/vite": "^4.3.2",
        clsx: "^2.1.1",
        hono: "^4.6.14",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        tailwindcss: "^4.3.2",
        tsx: "^4.19.2",
      },
      devDependencies: {
        "@eslint/js": "^9.39.5",
        "@originloom/tooling": originloom,
        "@types/node": "^22.10.2",
        "@types/react": "^19.0.2",
        "@types/react-dom": "^19.0.2",
        "@vitejs/plugin-react": "^5.2.0",
        eslint: "^9.39.5",
        "eslint-config-prettier": "^10.1.8",
        "eslint-plugin-simple-import-sort": "^13.0.0",
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

const tsconfig = (standalone) => {
  const extendsLine = standalone ? "" : `  "extends": "../../tsconfig.base.json",\n`;
  const options = standalone ? BASE_COMPILER_OPTIONS + APP_COMPILER_OPTIONS : APP_COMPILER_OPTIONS;
  return `{
${extendsLine}  "compilerOptions": {
${options}
  },
  "include": ["src", "server", "vite.config.ts", "vite.server.config.ts", "vitest.config.ts"]
}
`;
};

const eslintConfig = () => `import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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

const viteConfig = () => `import { resolve } from "node:path";

import { createClientViteConfig } from "@originloom/react/vite";
import { defineConfig } from "vite";

export default defineConfig(
  createClientViteConfig({
    entry: resolve(__dirname, "src/entry.client.tsx"),
    alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") },
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

const envDevelopment = (port, metricsPort) => `NODE_ENV=development
APP_ENV=development
PORT=${port}
METRICS_PORT=${metricsPort}
SITE_URL=http://127.0.0.1:${port}
VITE_DEV_SERVER_URL=http://127.0.0.1:5174

# L1-only cache; no Redis needed for local development.
CACHE_BACKEND=memory
CACHE_REQUIRED=false

# Upstream API. The generated app does not call it yet — wire it in your loaders.
GATEWAY_URL=http://127.0.0.1:4002
ALLOW_INSECURE_GATEWAY=true
`;

const envProduction = (port, metricsPort) => `NODE_ENV=production
APP_ENV=production
PORT=${port}
METRICS_PORT=${metricsPort}

# Required in production — set these from your secret manager / deployment env:
#   SITE_URL, GATEWAY_URL, RELEASE_ID, AUTH_REFRESH_COORDINATION_SECRET
# RELEASE_ID also namespaces the shared Redis cache, so give each app its own.

# Single-pod L1 cache. For a shared L2 cache across pods switch to redis and set
# REDIS_URL; CACHE_REQUIRED=true makes readiness fail when Redis is unreachable.
CACHE_BACKEND=memory
CACHE_REQUIRED=false
# CACHE_BACKEND=redis
# REDIS_URL=rediss://cache.internal:6379
`;

const serverIndex = () => `import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { createApp } from "@originloom/core/app";
import { readAssets } from "@originloom/core/assets";
import { cacheTopology, closeCache, initCache } from "@originloom/core/cache";
import { config, validateConfig } from "@originloom/core/config";
import { drainRevalidations } from "@originloom/core/handler";
import { logError, logger } from "@originloom/core/logger";
import { createMetricsApp } from "@originloom/core/metrics-server";
import { configureRouting } from "@originloom/shared/routing";
import { validateRoutingRules } from "@originloom/shared/routing/validate";

import { createRewrites, redirects, rewrites } from "~/routing/rules";

import { mountApi } from "./api";
import { installProductRuntime } from "./product/runtime";
import { routes } from "./routes";

let shuttingDown = false;
let httpServer: ServerType | null = null;
let metricsServer: ServerType | null = null;

async function main() {
  // The platform never imports product code; everything it needs is installed here.
  installProductRuntime();
  configureRouting({ redirects, rewrites, createRewrites });
  validateConfig();
  validateRoutingRules({ redirects, rewrites: createRewrites(config.gatewayUrl) });
  await initCache();

  const assets = readAssets({ eagerIslands: [] });
  const app = createApp({
    assets,
    routes,
    mounts: { api: mountApi },
    isShuttingDown: () => shuttingDown,
  });

  httpServer = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("server started", {
      port: info.port,
      cacheTopology: cacheTopology(),
      metricsPort: config.metricsPort,
    });
  });
  metricsServer = serve({ fetch: createMetricsApp().fetch, port: config.metricsPort });

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

main().catch((err) => {
  logError(err, { msg: "failed to start server" });
  process.exit(1);
});
`;

const routesIndex = () => `import type { Route } from "@originloom/react/lib/types";

import account from "./account";
import catalog from "./catalog";
import home from "./home";
import itemDetail from "./item-detail";
import live from "./live";
import showcase from "./showcase";

/** The route table. Order matters: the first match wins. */
export const routes: Route[] = [home, catalog, itemDetail, account, live, showcase];
`;

const homeRoute = (title) => `import { defineRoute } from "@originloom/react/lib/types";

import { HomePage } from "~/features/home/home-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { greeting: string };

export default defineRoute<Data>({
  path: "/",
  cache: (ctx) => pageCachePolicy(PageCacheId.home, ctx),
  loader: async () => ({ data: { greeting: "${title}" } }),
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

const itemsService =
  () => `/** Stand-in for gateway data. Replace these with real calls in server/services/. */
export type Item = { slug: string; name: string; blurb: string };

const ITEMS: Item[] = [
  { slug: "alpha", name: "Alpha", blurb: "İlk örnek kayıt." },
  { slug: "beta", name: "Beta", blurb: "İkinci örnek kayıt." },
  { slug: "gamma", name: "Gamma", blurb: "Üçüncü örnek kayıt." },
  { slug: "delta", name: "Delta", blurb: "Dördüncü örnek kayıt." },
  { slug: "epsilon", name: "Epsilon", blurb: "Beşinci örnek kayıt." },
  { slug: "zeta", name: "Zeta", blurb: "Altıncı örnek kayıt." },
  { slug: "eta", name: "Eta", blurb: "Yedinci örnek kayıt." },
];

export function getItem(slug: string): Item | undefined {
  return ITEMS.find((item) => item.slug === slug);
}

export function listItems(page: number, perPage: number): { items: Item[]; total: number } {
  const start = (page - 1) * perPage;
  return { items: ITEMS.slice(start, start + perPage), total: ITEMS.length };
}
`;

const apiIndex = () => `import type { AppVariables } from "@originloom/core/middleware/request-id";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

/**
 * Product BFF / API routes. Mounted before SSR dispatch, so anything under /api/*
 * is handled here and never reaches a page route.
 */
export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
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

const itemDetailRoute =
  () => `import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { defineRoute, notFound } from "@originloom/react/lib/types";
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
    const item = getItem(ctx.params.slug ?? "");
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

/**
 * Defer island: the server renders only the fallback; the client mounts this and
 * loads its own per-user data. Nothing here ever enters the shared page cache.
 */
export default function AccountPanel() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    // Stand-in for a per-user BFF fetch — runs only in the browser.
    setNow(new Date().toLocaleString());
  }, []);
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <p className="font-medium text-slate-900">Merhaba 👋</p>
      <p className="text-sm text-slate-600">
        Bu blok yalnızca tarayıcıda render edildi{now ? <> — {now}</> : null}. Kişisel veri buraya
        gelir ve hiçbir zaman paylaşılan cache'e girmez.
      </p>
    </div>
  );
}
`;

const catalogRoute = () => `import { defineRoute } from "@originloom/react/lib/types";
import { type Item, listItems } from "@server/services/items";

import { CatalogPage } from "~/features/catalog/catalog-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { pageParam } from "~/lib/pagination";
import { defaultPageMeta } from "~/lib/shell-data";

const PER_PAGE = 3;

type Data = { items: Item[]; page: number; totalPages: number };

export default defineRoute<Data>({
  path: "/catalog",
  // Only the normalized ?page value changes the HTML, so only it enters the key.
  cache: (ctx) => pageCachePolicy(PageCacheId.catalog, ctx),
  loader: async (ctx) => {
    const page = pageParam(ctx.url);
    const { items, total } = listItems(page, PER_PAGE);
    return { data: { items, page, totalPages: Math.max(1, Math.ceil(total / PER_PAGE)) } };
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

const liveRoute = () => `import { neverCache } from "@originloom/shared/lib/cache-policy";
import { defineRoute } from "@originloom/react/lib/types";

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
    source.addEventListener("tick", (event) => setTick((event as MessageEvent).data));
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
import { buildShellData } from "@server/services/shell-data";

import { isKnownPageCachePrefix } from "~/lib/cache-keys";
import { siteMetadata } from "~/lib/metadata/site-defaults";
import type { ShellData } from "~/lib/shell-data";

import { productDocumentShell } from "./document-shell";
import { productFragments } from "./fragments";

/**
 * The product side of the platform contract. @originloom/core reads this instead
 * of importing anything from this app.
 */
export const productRuntime: OriginRuntime<ShellData> = {
  // Cached HTML fragments resolved independently of the page (header, footer, …).
  fragments: productFragments,
  buildShellData,
  isShellUsableForFragments: () => true,
  document: productDocumentShell,
  cacheKeys: { isKnownPageCachePrefix },
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
import { MetadataHead } from "@originloom/react/lib/metadata/metadata-head";
import { resolveDocumentMetadata } from "@originloom/shared/lib/metadata/resolve";
import type { Ctx, Route } from "@originloom/react/lib/types";

import { RootLayout } from "~/components/layout/root-layout";
import { defaultPageMeta, type ShellData } from "~/lib/shell-data";

import { NotFoundPage, RouteErrorPage } from "./boundary-pages";

const BOT_UA = /bot|crawl|spider|slurp|bingpreview/i;

/** Document chrome: what wraps every rendered route. */
export const productDocumentShell: DocumentShell<ShellData> = {
  htmlLang: "tr",
  errorPageTitle: "Sayfa gösterilemiyor | ${title}",
  isBotRequest: (request) => BOT_UA.test(request.headers.get("user-agent") ?? ""),
  resolveMetadata: <T,>(route: Route<T>, data: T, ctx: Ctx) =>
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
  NotFoundComponent: NotFoundPage,
  ErrorComponent: RouteErrorPage,
  renderHeadStart: ({ seo, cspNonce }) => <MetadataHead meta={seo} nonce={cspNonce} />,
  // Analytics bootstrap (GTM etc.) belongs here.
  renderHeadEnd: () => null,
  renderLayout: ({ shell, pageMeta, children }) => (
    <RootLayout shell={shell} pageMeta={pageMeta}>
      {children}
    </RootLayout>
  ),
};
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

export function HomePage({ data }: { data: { greeting: string } }) {
  return (
    <div className="space-y-6">
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

/** Application shell. Header/footer that need their own cache lifetime belong in fragments. */
export function RootLayout({ shell, children }: RootLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      {shell.minimalChrome ? null : (
        <header className="border-b border-slate-200">
          <div className="mx-auto flex max-w-5xl items-center px-4 py-4">
            <a href="/" className="text-lg font-semibold text-slate-900">
              ${title}
            </a>
          </div>
        </header>
      )}

      <main id="page-main" className="flex-1 py-10">
        <div className="mx-auto max-w-5xl px-4">{children}</div>
      </main>

      {shell.minimalChrome ? null : (
        <footer className="border-t border-slate-200 py-6">
          <div className="mx-auto max-w-5xl px-4 text-sm text-slate-500">${title} — OriginLoom</div>
        </footer>
      )}
    </div>
  );
}
`;

const libShellData =
  () => `import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import { Cookie } from "@originloom/shared/lib/cookies";
import type { DeviceType } from "@originloom/shared/lib/device";
import { deviceCacheFragment, getDeviceShell } from "@originloom/shared/lib/device";
import { cookie } from "@originloom/shared/lib/request";
import type { Ctx } from "@originloom/react/lib/types";

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

const cacheKeys =
  () => `import { neverCache, sharedUnlessBypass } from "@originloom/shared/lib/cache-policy";
import { locale } from "@originloom/shared/lib/request";
import type { CachePolicy, Ctx } from "@originloom/react/lib/types";

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
    icons: { icon: "/favicon.ico" },
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

# The server bundle is self-contained (ssr.noExternal: true) — no node_modules needed.
COPY --from=builder --chown=nodejs:nodejs ${distPath} ./dist
RUN printf '{"type":"module"}\\n' > package.json

USER nodejs

EXPOSE ${port}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||${port})+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server/index.js"]
`;

const readme = (name, title, port, standalone) => `# ${title}

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

Uygulama \`http://127.0.0.1:${port}\`, client modülleri Vite dev server'dan (\`:5174\`) gelir.${
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
| \`server/services/\`      | Server-only veri orkestrasyonu (gateway çağrıları buraya)              |
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
