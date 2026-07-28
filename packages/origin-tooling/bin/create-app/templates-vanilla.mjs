/**
 * Templates for `origin-create-app --vanilla`: an app with no UI framework.
 *
 * Only the files that touch rendering differ from the React set — routes,
 * pages, islands, the client entry and the product renderer. Everything else
 * (server composition root, services, cache registry shape, config, Docker, CI)
 * is shared, because the platform below them does not care what draws the HTML.
 */

export const viteConfig = (vitePort) => `import { resolve } from "node:path";

import { createClientViteConfig } from "@originloom/vanilla/vite";
import { defineConfig } from "vite";

export default defineConfig(
  createClientViteConfig({
    entry: resolve(__dirname, "src/entry.client.ts"),
    alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") },
    // Every app owns a port, so several can run side by side.
    devServer: { port: ${vitePort} },
    reload: {
      shouldReload: (file) =>
        file.includes("/server/") || file.includes("/src/pages/") || file.includes("/src/components/"),
    },
  }),
);
`;

export const viteServerConfig = () => `import { resolve } from "node:path";

import { createServerViteConfig } from "@originloom/vanilla/vite";
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

export const routesIndex = () => `import type { Route } from "@originloom/vanilla/lib/types";

import catalog from "./catalog";
import home from "./home";
import itemDetail from "./item-detail";

/** The route table. Order matters: the first match wins. */
export const routes: Route[] = [home, catalog, itemDetail];
`;

export const homeRoute = (title) => `import { defineRoute } from "@originloom/vanilla/lib/types";

import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";
import { homePage } from "~/pages/home";

const GREETING = "${title}";

type Data = { greeting: string };

export default defineRoute<Data>({
  path: "/",
  cache: (ctx) => pageCachePolicy(PageCacheId.home, ctx),
  loader: async () => ({ data: { greeting: GREETING } }),
  title: () => GREETING,
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "home"),
  Component: homePage,
});
`;

export const catalogRoute = () => `import { defineRoute } from "@originloom/vanilla/lib/types";
import { observeCatalogView } from "@server/metrics/catalog";
import { productConfig } from "@server/product/config";
import { type Item, listItems } from "@server/services/items";

import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { pageParam } from "~/lib/pagination";
import { defaultPageMeta } from "~/lib/shell-data";
import { catalogPage } from "~/pages/catalog";

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
  Component: catalogPage,
});
`;

export const itemDetailRoute =
  () => `import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { defineRoute, notFound } from "@originloom/vanilla/lib/types";
import { getItem, type Item } from "@server/services/items";

import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";
import { itemDetailPage } from "~/pages/item-detail";

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
  Component: itemDetailPage,
});
`;

export const productRuntime =
  () => `import { installRuntime, type OriginRuntime } from "@originloom/core/runtime";
import { configureSiteMetadata } from "@originloom/shared/lib/metadata/site-config";
import { catalogMetricLines } from "@server/metrics/catalog";
import { buildShellData } from "@server/services/shell-data";

import { isKnownPageCachePrefix } from "~/lib/cache-keys";
import { siteMetadata } from "~/lib/metadata/site-defaults";
import type { ShellData } from "~/lib/shell-data";

import { productDocumentShell } from "./document-shell";
import { productRenderer } from "./renderer";

/**
 * The product side of the platform contract. @originloom/core reads this instead
 * of importing anything from this app.
 */
export const productRuntime: OriginRuntime<ShellData> = {
  // Turns this app's HTML nodes into the response. Swapping this swaps the renderer.
  renderer: productRenderer,
  // Cached HTML fragments resolved independently of the page (header, footer, …).
  fragments: {},
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

export const productRenderer =
  () => `import { metadataHead } from "@originloom/vanilla/lib/metadata-head";
import { createHtmlRenderer } from "@originloom/vanilla/server";

import { layout } from "~/components/layout";
import type { ShellData } from "~/lib/shell-data";

import { errorPage, notFoundPage } from "./boundary-pages";

/** Every view the document renders. No UI framework involved — just strings. */
export const productRenderer = createHtmlRenderer<ShellData>({
  notFoundPage,
  errorPage,
  renderHeadStart: ({ seo, cspNonce }) => metadataHead(seo, cspNonce),
  // Analytics bootstrap (GTM etc.) belongs here.
  renderLayout: ({ shell, children }) => layout(shell, children),
});
`;

export const boundaryPages = () => `import { html } from "@originloom/vanilla/html";
import type { RouteError } from "@originloom/vanilla/lib/types";

export function notFoundPage() {
  return html\`<div class="mx-auto max-w-2xl space-y-3 py-16 text-center">
    <p class="text-sm font-semibold text-slate-500">404</p>
    <h1 class="text-2xl font-bold text-slate-900">Aradığınız sayfa bulunamadı</h1>
    <a class="inline-block font-medium text-slate-700 hover:underline" href="/">Ana sayfaya dön</a>
  </div>\`;
}

export function errorPage({ error }: { error: RouteError | null; status: number }) {
  return html\`<div class="mx-auto max-w-2xl space-y-3 py-16 text-center">
    <h1 class="text-2xl font-bold text-slate-900">Bu sayfa şu anda gösterilemiyor</h1>
    <p class="text-slate-600">\${error?.message ?? "Lütfen daha sonra tekrar deneyin."}</p>
    <button
      type="button"
      data-reload-page
      class="cursor-pointer border-0 bg-transparent p-0 font-medium text-slate-700 hover:underline"
    >
      Tekrar dene
    </button>
  </div>\`;
}
`;

export const entryClient = () => `import "./styles/globals.css";

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

export const hydrateClient =
  () => `import { createIslandMounter, type IslandModule } from "@originloom/vanilla/client/island-mount";

// import.meta.glob resolves relative to this file, so the island registry is
// app-owned by design. Every src/islands/*.ts becomes an island named after it.
export const mount = createIslandMounter({
  modules: import.meta.glob<IslandModule>("./islands/*.ts"),
});
`;

export const counterIsland =
  () => `import type { IslandMount } from "@originloom/vanilla/client/island-mount";

/**
 * Example island — proves the client wakes up server-rendered markup.
 * The element already contains the server HTML; wire behaviour onto it.
 */
const mount: IslandMount = (element, props) => {
  const button = element.querySelector("button");
  if (!button) return;

  let count = Number(props.start ?? 0);
  button.addEventListener("click", () => {
    count += 1;
    button.textContent = \`Sayaç: \${count}\`;
  });
};

export default mount;
`;

export const layoutComponent = (
  title,
) => `import { html, type HtmlNode } from "@originloom/vanilla/html";

import type { ShellData } from "~/lib/shell-data";

const SITE_NAME = "${title}";

/** Application shell. Header/footer that need their own cache lifetime belong in fragments. */
export function layout(shell: ShellData, children: HtmlNode): HtmlNode {
  return html\`<div class="flex min-h-screen flex-col">
    \${shell.minimalChrome
      ? null
      : html\`<header class="border-b border-slate-200">
          <div class="mx-auto flex max-w-5xl items-center px-4 py-4">
            <a href="/" class="text-lg font-semibold text-slate-900">\${SITE_NAME}</a>
          </div>
        </header>\`}
    <main id="page-main" class="flex-1 py-10">
      <div class="mx-auto max-w-5xl px-4">\${children}</div>
    </main>
    \${shell.minimalChrome
      ? null
      : html\`<footer class="border-t border-slate-200 py-6">
          <div class="mx-auto max-w-5xl px-4 text-sm text-slate-500">
            \${SITE_NAME} — OriginLoom
          </div>
        </footer>\`}
  </div>\`;
}
`;

export const homePage = () => `import { html } from "@originloom/vanilla/html";
import { island } from "@originloom/vanilla/lib/island";

/**
 * A page is a function from loader data to HTML. \`html\` escapes every
 * interpolated value; wrap trusted markup in \`raw()\` to opt out.
 */
export function homePage({ data }: { data: { greeting: string } }) {
  return html\`<div class="space-y-8">
    <section class="space-y-3">
      <h1 class="text-3xl font-bold text-slate-900">\${data.greeting}</h1>
      <p class="text-slate-600">
        Sunucuda render edilir, HTML cache'lenir, yalnız aşağıdaki ada JavaScript indirir.
      </p>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold tracking-wide text-slate-500 uppercase">Ada (island)</h2>
      \${island({
        name: "counter",
        props: { start: 0 },
        children: html\`<button
          type="button"
          class="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
        >
          Sayaç: 0
        </button>\`,
      })}
    </section>

    <section class="space-y-2">
      <h2 class="text-sm font-semibold tracking-wide text-slate-500 uppercase">Sayfalar</h2>
      <ul class="list-inside list-disc text-slate-700">
        <li><a class="hover:underline" href="/catalog">/catalog</a> — sayfalama + cache key</li>
        <li>
          <a class="hover:underline" href="/items/alpha">/items/alpha</a> — dinamik route + 404
        </li>
      </ul>
    </section>
  </div>\`;
}
`;

export const catalogPage = () => `import { html } from "@originloom/vanilla/html";
import type { Item } from "@server/services/items";

type Data = { items: Item[]; page: number; totalPages: number };

export function catalogPage({ data }: { data: Data }) {
  return html\`<div class="space-y-6">
    <h1 class="text-2xl font-bold text-slate-900">Katalog</h1>

    <ul class="divide-y divide-slate-200 rounded-md border border-slate-200">
      \${data.items.map(
        (item) => html\`<li class="p-4">
          <a class="font-medium text-slate-900 hover:underline" href="/items/\${item.slug}">
            \${item.name}
          </a>
          <p class="text-sm text-slate-600">\${item.blurb}</p>
        </li>\`,
      )}
    </ul>

    <nav class="flex items-center gap-3 text-sm">
      \${data.page > 1
        ? html\`<a class="hover:underline" href="/catalog?page=\${data.page - 1}">← Önceki</a>\`
        : null}
      <span class="text-slate-500">\${data.page} / \${data.totalPages}</span>
      \${data.page < data.totalPages
        ? html\`<a class="hover:underline" href="/catalog?page=\${data.page + 1}">Sonraki →</a>\`
        : null}
    </nav>
  </div>\`;
}
`;

export const itemDetailPage = () => `import { html } from "@originloom/vanilla/html";
import type { Item } from "@server/services/items";

export function itemDetailPage({ data }: { data: { item: Item } }) {
  return html\`<article class="space-y-4">
    <h1 class="text-2xl font-bold text-slate-900">\${data.item.name}</h1>
    <p class="text-slate-600">\${data.item.blurb}</p>
    <a class="inline-block font-medium text-slate-700 hover:underline" href="/catalog">
      ← Katalog
    </a>
  </article>\`;
}
`;

export const libShellData =
  () => `import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import { Cookie } from "@originloom/shared/lib/cookies";
import type { DeviceType } from "@originloom/shared/lib/device";
import { deviceCacheFragment, getDeviceShell } from "@originloom/shared/lib/device";
import { cookie } from "@originloom/shared/lib/request";
import type { Ctx } from "@originloom/shared/lib/types";

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

export const serverShellData = () => `import type { Ctx } from "@originloom/shared/lib/types";

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

export const cacheKeys =
  () => `import { neverCache, sharedUnlessBypass } from "@originloom/shared/lib/cache-policy";
import { locale } from "@originloom/shared/lib/request";
import type { CachePolicy, Ctx } from "@originloom/shared/lib/types";

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
};

/** Route \\\`cache\\\` handler — derives the policy from the registry. */
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

export const globalsCss = (standalone) => `@import "tailwindcss";

/* The platform packages render utility classes outside this app's own source,
   so Tailwind must scan them too — as workspace source, or as installed dist. */
@source "${standalone ? "../../node_modules/@originloom/vanilla/dist" : "../../../../packages/origin-vanilla/src"}";
@source "${standalone ? "../../node_modules/@originloom/shared/dist" : "../../../../packages/origin-shared/src"}";

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}

body {
  font-family: var(--font-sans);
}
`;

export const apiIndex =
  () => `import { mountClientErrorApi } from "@originloom/core/api/client-errors";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountPublicItemsApi } from "@server/api/items";
import { mountSessionApi } from "@server/api/session";
import type { Hono } from "hono";

/**
 * Product BFF / API routes. Mounted before SSR dispatch, so anything under /api/*
 * is handled here and never reaches a page route. Islands that need per-user data
 * fetch it from here instead of putting it in the cached HTML.
 */
export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  // The island runtime reports client-side failures here. Without it every
  // browser error turns into a 404 in the console instead of a server log.
  mountClientErrorApi(app);

  mountPublicItemsApi(app);

  // "Who am I", answered from HttpOnly cookies — see server/api/session.ts.
  mountSessionApi(app);

  app.get("/api/time", (c) => c.json({ now: new Date().toISOString() }));
}
`;

export const readme = (name, title, port, vitePort, standalone) => `# ${title}

OriginLoom ürün uygulaması (renderer: **vanilla** — UI framework yok). Platform runtime'ı
\\\`@originloom/core\\\`, \\\`@originloom/shared\\\` ve \\\`@originloom/vanilla\\\` paketlerinden gelir; bu repo
yalnız route tablosunu, ürün kontratını ve kendi chrome'unu içerir.

Sayfalar \\\`html\\\` tagged template'i ile yazılır: interpolate edilen her değer otomatik escape
edilir, güvendiğiniz markup için \\\`raw()\\\` kullanılır. Etkileşim gereken yerlerde island'lar
düz TypeScript modülleridir — \\\`(element, props) => void\\\`.

## Geliştirme

\\\`\\\`\\\`bash
${
  standalone
    ? `pnpm install                 # @originloom/* registry erişimi gerektirir
pnpm dev`
    : `pnpm install                 # repo kökünden, bir kez
pnpm --filter ${name} dev`
}
\\\`\\\`\\\`

Uygulama \\\`http://127.0.0.1:${port}\\\`, client modülleri Vite dev server'dan (\\\`:${vitePort}\\\`) gelir.${
  standalone
    ? `\nUpstream gateway'i \\\`.env.development\\\` içindeki \\\`GATEWAY_URL\\\` ile ayarlayın.`
    : ""
}

## Yapı

| Yol                     | Sorumluluk                                                             |
| ----------------------- | ---------------------------------------------------------------------- |
| \\\`server/index.ts\\\`       | Composition root — runtime, routing ve app burada kurulur              |
| \\\`server/routes/\\\`        | Route tanımları (loader + cache + Component)                           |
| \\\`server/product/\\\`       | Platforma verilen kontrat: runtime, renderer, document shell, boundary |
| \\\`server/services/\\\`      | Server-only veri orkestrasyonu — gateway çağrıları ve guard'lar        |
| \\\`mock-gateway/\\\`        | Geliştirme için sahte upstream; \\\`pnpm dev\\\` otomatik başlatır       |
| \\\`src/pages/\\\`            | Sayfa fonksiyonları — loader verisi → HTML                             |
| \\\`src/islands/\\\`          | Client etkileşim noktaları — dosya adı island adıdır                   |
| \\\`src/lib/cache-keys.ts\\\` | Sayfa cache registry'si — cache'lenen her sayfa buraya girer           |
| \\\`src/routing/rules.ts\\\`  | Redirect / rewrite kuralları                                           |

## Yeni sayfa ekleme

1. \\\`src/lib/cache-keys.ts\\\` içine cache tanımı ekle (cache'lenecekse).
2. \\\`server/routes/<sayfa>.ts\\\` içinde \\\`defineRoute\\\` ile route'u yaz.
3. \\\`server/routes/index.ts\\\` route tablosuna ekle — sıra önemli, ilk eşleşen kazanır.
4. Sayfayı \\\`src/pages/\\\` altına koy; etkileşim gerekiyorsa \\\`src/islands/\\\` + \\\`island()\\\`.

## Deploy

\\\`\\\`\\\`bash
${
  standalone
    ? `pnpm build                           # dist/client + dist/server/index.js
docker build -t ${name} .`
    : `pnpm --filter ${name} build          # dist/client + dist/server/index.js
docker build -f apps/${name}/Dockerfile -t ${name} .`
}
\\\`\\\`\\\`

Production'da \\\`SITE_URL\\\`, \\\`GATEWAY_URL\\\`, \\\`RELEASE_ID\\\` ve
\\\`AUTH_REFRESH_COORDINATION_SECRET\\\` zorunludur. \\\`RELEASE_ID\\\` ortak Redis'te cache
namespace'ini de belirler — her uygulamaya kendine ait bir değer verin.
`;
