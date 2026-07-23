/**
 * Templates for `origin-create-app`.
 *
 * Every file here is app-owned by design. Anything generic — cache, middleware,
 * SSR pipeline, island runtime, metadata engine — stays in @originloom/core and
 * @originloom/react and is consumed, never copied.
 */

/** @param {{ name: string; title: string; port: number; metricsPort: number }} vars */
export function renderTemplates({ name, title, port, metricsPort }) {
  return {
    "package.json": packageJson(name),
    "tsconfig.json": tsconfig(),
    "vite.config.ts": viteConfig(),
    "vite.server.config.ts": viteServerConfig(),
    "vitest.config.ts": vitestConfig(name),
    ".env.development": envDevelopment(port, metricsPort),
    ".env.production": envProduction(port, metricsPort),
    "README.md": readme(name, title, port),
    Dockerfile: dockerfile(name, port),

    "server/index.ts": serverIndex(),
    "server/routes/index.ts": routesIndex(),
    "server/routes/home.tsx": homeRoute(title),
    "server/services/shell-data.ts": serverShellData(),
    "server/product/runtime.ts": productRuntime(),
    "server/product/document-shell.tsx": productDocumentShell(title),
    "server/product/boundary-pages.tsx": boundaryPages(),

    "src/entry.client.tsx": entryClient(),
    "src/hydrate.client.tsx": hydrateClient(),
    "src/islands/counter.tsx": counterIsland(),
    "src/features/home/home-page.tsx": homePage(),
    "src/components/layout/root-layout.tsx": rootLayout(title),
    "src/lib/shell-data.ts": libShellData(),
    "src/lib/cache-keys.ts": cacheKeys(),
    "src/lib/metadata/site-defaults.ts": siteDefaults(title),
    "src/routing/rules.ts": routingRules(),
    "src/styles/globals.css": globalsCss(),
  };
}

const packageJson = (name) =>
  `${JSON.stringify(
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
        test: "vitest run",
      },
      dependencies: {
        "@hono/node-server": "^1.13.7",
        "@originloom/core": "workspace:*",
        "@originloom/react": "workspace:*",
        "@tailwindcss/vite": "^4.3.2",
        clsx: "^2.1.1",
        hono: "^4.6.14",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        tailwindcss: "^4.3.2",
        tsx: "^4.19.2",
      },
      devDependencies: {
        "@originloom/tooling": "workspace:*",
        "@types/node": "^22.10.2",
        "@types/react": "^19.0.2",
        "@types/react-dom": "^19.0.2",
        "@vitejs/plugin-react": "^5.2.0",
        typescript: "^5.7.2",
        vite: "^8.1.5",
        vitest: "^4.1.10",
      },
    },
    null,
    2,
  )}\n`;

const tsconfig = () =>
  `${JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        types: ["node", "vite/client"],
        baseUrl: ".",
        paths: { "~/*": ["./src/*"], "@server/*": ["./server/*"] },
      },
      include: ["src", "server", "vite.config.ts", "vite.server.config.ts", "vitest.config.ts"],
    },
    null,
    2,
  )}\n`;

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
import { configureRouting } from "@originloom/react/routing";
import { validateRoutingRules } from "@originloom/react/routing/validate";

import { createRewrites, redirects, rewrites } from "~/routing/rules";

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
  const app = createApp({ assets, routes, isShuttingDown: () => shuttingDown });

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

import home from "./home";

/** The route table. Order matters: the first match wins. */
export const routes: Route[] = [home];
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
import { configureSiteMetadata } from "@originloom/react/lib/metadata/site-config";
import { buildShellData } from "@server/services/shell-data";

import { isKnownPageCachePrefix } from "~/lib/cache-keys";
import { siteMetadata } from "~/lib/metadata/site-defaults";
import type { ShellData } from "~/lib/shell-data";

import { productDocumentShell } from "./document-shell";

/**
 * The product side of the platform contract. @originloom/core reads this instead
 * of importing anything from this app.
 */
export const productRuntime: OriginRuntime<ShellData> = {
  // Cached HTML fragments resolved independently of the page (header, footer, …).
  fragments: {},
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
import { mergeMetadata } from "@originloom/react/lib/metadata/merge";
import { MetadataHead } from "@originloom/react/lib/metadata/metadata-head";
import { resolveDocumentMetadata } from "@originloom/react/lib/metadata/resolve";
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

import { reportClientError } from "@originloom/react/lib/client/error-telemetry";
import { runIslandBootstrap } from "@originloom/react/lib/client/island-runtime";
import { installReloadButtons } from "@originloom/react/lib/client/reload-button";

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

const hydrateClient = () => `import {
  createIslandMounter,
  type IslandModule,
} from "@originloom/react/lib/client/island-mount";

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
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white"
        >
          Tıklandı: 0
        </button>
      </Island>
      <p className="text-sm text-slate-500">
        Sonraki adım: <code>server/routes/</code> altına route ekle,{" "}
        <code>src/features/</code> altında bileşenini yaz.
      </p>
    </div>
  );
}
`;

const rootLayout = (
  title,
) => `import type { PageAnalyticsMeta } from "@originloom/react/lib/analytics/types";
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
          <div className="mx-auto max-w-5xl px-4 text-sm text-slate-500">
            ${title} — OriginLoom
          </div>
        </footer>
      )}
    </div>
  );
}
`;

const libShellData =
  () => `import type { PageAnalyticsMeta } from "@originloom/react/lib/analytics/types";
import { Cookie } from "@originloom/react/lib/cookies";
import type { DeviceType } from "@originloom/react/lib/device";
import { deviceCacheFragment, getDeviceShell } from "@originloom/react/lib/device";
import { cookie } from "@originloom/react/lib/request";
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
  () => `import { neverCache, sharedUnlessBypass } from "@originloom/react/lib/cache-policy";
import { locale } from "@originloom/react/lib/request";
import type { CachePolicy, Ctx } from "@originloom/react/lib/types";

import { layoutCacheFragment } from "~/lib/shell-data";

/**
 * HTML page cache identities. The purge API and the metrics route labels are
 * derived from this registry, so every cacheable page needs an entry here.
 */
export const PageCacheId = {
  home: "home",
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
) => `import type { SiteMetadataConfig } from "@originloom/react/lib/metadata/types";

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
  () => `import type { RedirectRule, RewriteRule } from "@originloom/react/routing/types";

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

const globalsCss = () => `@import "tailwindcss";

/* Workspace packages live outside this app's root — scan them for utility classes. */
@source "../../../../packages/origin-react/src";

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}

body {
  font-family: var(--font-sans);
}
`;

const dockerfile = (name, port) => `# Build context is the repository root:
#   docker build -f apps/${name}/Dockerfile -t ${name} .
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter ${name} typecheck && pnpm --filter ${name} build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=${port}

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# The server bundle is self-contained (ssr.noExternal: true) — no node_modules needed.
COPY --from=builder --chown=nodejs:nodejs /repo/apps/${name}/dist ./dist
RUN printf '{"type":"module"}\\n' > package.json

USER nodejs

EXPOSE ${port}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||${port})+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server/index.js"]
`;

const readme = (name, title, port) => `# ${title}

OriginLoom ürün uygulaması. Platform runtime'ı \`@originloom/core\` ve \`@originloom/react\`
paketlerinden gelir; bu repo yalnız route tablosunu, ürün kontratını ve kendi chrome'unu içerir.

## Geliştirme

\`\`\`bash
pnpm install                 # repo kökünden, bir kez
pnpm --filter ${name} dev
\`\`\`

Uygulama \`http://127.0.0.1:${port}\`, client modülleri Vite dev server'dan (\`:5174\`) gelir.

## Yapı

| Yol | Sorumluluk |
| --- | ---------- |
| \`server/index.ts\` | Composition root — runtime, routing ve app burada kurulur |
| \`server/routes/\` | Route tanımları (loader + cache + Component) |
| \`server/product/\` | Platforma verilen kontrat: runtime, document shell, boundary sayfaları |
| \`server/services/\` | Server-only veri orkestrasyonu (gateway çağrıları buraya) |
| \`src/features/\` | Sayfa bileşenleri |
| \`src/islands/\` | Client etkileşim noktaları — dosya adı island adıdır |
| \`src/lib/cache-keys.ts\` | Sayfa cache registry'si — cache'lenen her sayfa buraya girer |
| \`src/routing/rules.ts\` | Redirect / rewrite kuralları |

## Yeni sayfa ekleme

1. \`src/lib/cache-keys.ts\` içine cache tanımı ekle (cache'lenecekse).
2. \`server/routes/<sayfa>.tsx\` içinde \`defineRoute\` ile route'u yaz.
3. \`server/routes/index.ts\` route tablosuna ekle — sıra önemli, ilk eşleşen kazanır.
4. Bileşeni \`src/features/\` altına koy; etkileşim gerekiyorsa \`src/islands/\` + \`<Island />\`.

## Deploy

\`\`\`bash
pnpm --filter ${name} build          # dist/client + dist/server/index.js
docker build -f apps/${name}/Dockerfile -t ${name} .
\`\`\`

Production'da \`SITE_URL\`, \`GATEWAY_URL\`, \`RELEASE_ID\` ve
\`AUTH_REFRESH_COORDINATION_SECRET\` zorunludur. \`RELEASE_ID\` ortak Redis'te cache
namespace'ini de belirler — her uygulamaya kendine ait bir değer verin.
`;
