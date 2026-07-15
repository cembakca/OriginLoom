# ssr-kit Conventions

## Folder layout

| Directory | Purpose |
|---|---|
| `src/routes/{name}/` | One folder per page — `index.tsx` exports `defineRoute()` |
| `src/islands/` | Client-only widgets — one file per island, auto-discovered by Vite |
| `src/components/` | Shared SSR-safe UI (no hooks) |
| `src/services/` | Data layer — loaders and API handlers call these |
| `src/lib/` | Pure utilities (router, types, request helpers) |
| `server/` | HTTP runtime — never goes through Vite |
| `tests/` | Mirrors `server/` and `src/lib/` |

## Naming

- Route folder: kebab-case (`loan-compare`)
- Island file: kebab-case, must match `<Island name="..." />`
- Component export: PascalCase, file name kebab-case
- Service functions: camelCase (`getOffers`, `getMe`)

## Add a new page (route)

1. Create `src/routes/{feature}/index.tsx` with `defineRoute()`
2. Add route-specific SSR markup in `components.tsx` (same folder) if needed
3. Extract heavy loader logic to `loader.ts` (optional)
4. Register in `src/routes/index.ts` — order by specificity (first match wins)
5. For interactivity: add `src/islands/{name}.tsx` and use `<Island />` in the route

## Add a new island

1. Create `src/islands/{kebab-name}.tsx` — default export
2. Reference in route: `<Island name="kebab-name" mode="hydrate|defer" />`
3. Do not edit `entry.client.tsx` — Vite glob picks up new files automatically
4. Per-user data: SSR loader + `gatewayFetch`; anonim cache HTML'de kişisel alan gösterme

## HTML cache

See **HTML cache — `sharedUnlessBypass`** under Middleware pipeline, or [`src/lib/cache-policy.ts`](../src/lib/cache-policy.ts).

## Add a shared component

1. Create `src/components/{category}/{name}.tsx`
2. Must be SSR-safe — no `useState`, `useEffect`, or browser APIs
3. Import from routes: `import { SiteHeader } from "../../components/layout/site-header"`

## Add an API endpoint

1. Create `server/api/{name}.ts` with a handler function
2. Mount in `server/api/index.ts`
3. Call `src/services/` — share logic with route loaders

## Add a service

1. Create `src/services/{domain}.ts` — async functions + types only
2. Import from route loaders and API handlers

## Metadata / head — iki kanal

Next.js'teki **Metadata API** + **manuel `<head>`** ayrımının karşılığı.

### Kanal 1 — Metadata API (`generateMetadata`)

| Katman | Dosya | Ne |
|---|---|---|
| Site defaults | `src/lib/metadata/site-defaults.ts` | title template, description, OG/Twitter site, icons, robots |
| Route override | `route.generateMetadata(data, ctx)` | title, description, canonical, robots, OG/Twitter sayfa |
| Merge | `src/lib/metadata/merge.ts` | layout ⊎ page — page ezer |
| HTML | `src/components/head/metadata-head.tsx` | `<title>`, meta, canonical, OG, Twitter |

```ts
// Loader'da seoInfo fetch et — generateMetadata ayrı API çağırmasın
loader: async (ctx) => {
  const page = await fetchRetirementBankingPage(ctx.request);
  return { data: { ...page } };
},

generateMetadata: (data, ctx) =>
  data.seoInfo
    ? generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx)
    : generateMetaDataForPageWithDummySeoInfo("/retirement-banking", ctx),
```

**seoInfo alanları → Metadata:**

| seoInfo | Metadata | HTML |
|---|---|---|
| `title` | `title` | `<title>` (+ `%s \| Hangikredi` template) |
| `metaDescription` | `description` | `<meta name="description">` |
| `canonicalUrl` | `canonical` | `<link rel="canonical">` |
| `noindex` | `robots.index` | `<meta name="robots">` |
| `image` | `openGraph.image` / `twitter.image` | og:image, twitter:image |

### Kanal 2 — Manuel head (teknik bootstrap)

| Bileşen | Sorumluluk |
|---|---|
| `HeadClient` | dns-prefetch, preconnect (GTM, CDN) |
| `GtmBootstrap` | dataLayer, EventQueue, hk.tracking, gtm.js |
| `layout-client` / `page-analytics` | Store + pageview (metadata dışı) |

**SEO meta ≠ GTM.** Analytics script'leri `generateMetadata`'ya girmez.

### Metadata dışı

| Şey | Nerede |
|---|---|
| JSON-LD / breadcrumb | Body — `PageSchema` (gelecek) |
| GTM pageview | `page-analytics` island |
| H1 / hero | Route `Component` (`headingTitle` metadata'dan ayrı) |

### Env

```bash
SITE_URL=https://www.hangikredi.com   # canonical / OG url base
```

## Page open pipeline — Layout + GTM + PageAnalytics

Next.js `layout.tsx` + `page.client.tsx` karşılığı. Tek root shell tüm route'ları sarar; route farkı `pageMeta` + route `Component` ile gelir.

### Zaman sırası

```
1. Middleware          auth → session/tracking → CMS redirect
2. handler             rules.ts → cache → loader → renderDocument
3. document (SSR)      head: dataLayer=[] → EventQueue → hk.tracking → GTM
                       body: layout-client → main → page-analytics
4. entry.client        layout-client (store seed) → page-analytics (pageview)
5. EventQueue          originalLocation → GAVirtual → signalReactReady → gtm.dom/load
```

### Dosya haritası

| Next.js | ssr-kit | Sorumluluk |
|---|---|---|
| `app/layout.tsx` | `server/document.tsx` + `RootLayout` | HTML shell, GTM bootstrap |
| `layout.client.tsx` | `src/islands/layout-client.tsx` | Chrome + store seed (defer, eager) |
| `page.tsx` | `src/routes/*/index.tsx` loader + Component | Veri fetch + SSR UI |
| `page.client.tsx` | `src/islands/page-analytics.tsx` | **Sadece** page-view dataLayer |
| Container | route `Component` + `<Island />` | UI + interaktivite |

### GTM bootstrap (root only)

[`src/components/analytics/gtm-bootstrap.tsx`](../src/components/analytics/gtm-bootstrap.tsx) — head sırası:

1. `window.dataLayer = []`
2. EventQueue interceptor (`gtm.dom` / `gtm.load` bekletilir)
3. `hk.tracking` — cookie'den `user_tracking_id` (cache-safe inline script)
4. dns-prefetch / preconnect
5. GTM container (`GTM_CONTAINER_ID` env)
6. noscript iframe (bot değilse)

**Kural:** GTM bootstrap yalnızca root layout'ta. Pageview route'a özel.

### PageAnalytics (route page.client)

Route'ta `pageMeta` tanımla — cache-safe alanlar:

```ts
pageMeta: (data, ctx) => defaultPageMeta(ctx, "loan-compare", {
  category: "credit",
  mid: "ihtiyac-kredisi",
  sub: data.city,
}),
```

`RootLayout` otomatik `<Island name="page-analytics" mode="defer" eager />` render eder.

Pageview sırası ([`src/lib/analytics/page-view.ts`](../src/lib/analytics/page-view.ts)):

1. `originalLocation` (sessionStorage ile korunur)
2. `GAVirtual` + `page-{pageType}` event
3. `signalReactReady()` → gtm.dom serbest

Login state `layout-client` store'dan okunur — pageview'den **önce** seed edilir (DOM sırası).

### Cache + analytics

| Veri | SSR HTML'de? | Neden |
|---|---|---|
| GTM container ID | Evet | Herkes aynı |
| `user_tracking_id` | **Hayır** | Cookie'den client okur |
| `isSignedIn` / token | **Hayır** | layout-client cookie okur |
| `pageMeta` (category, path) | Evet (island props) | Cache key parçası / anonim |
| Kişisel user adı | BYPASS route'larda SSR OK | `neverCache()` veya token BYPASS |

Anonim ziyaretçi cached HTML alır → layout-client + page-analytics client'ta cookie'den kimlik okur → doğru GTM context.

### Env

```bash
GTM_CONTAINER_ID=GTM-XXXXXX   # boş = GTM devre dışı
```

### Yeni route checklist

1. `defineRoute()` + `sharedUnlessBypass` cache
2. `pageMeta` — pageview kategorisi
3. `Component` — sadece sayfa içeriği (header/footer yok)
4. Interaktivite → `src/islands/` + `<Island mode="hydrate" />`

## Middleware pipeline

Next.js `middleware.ts` karşılığı: [`server/middleware/pipeline.ts`](../server/middleware/pipeline.ts)

**Sıra:** auth → session/tracking → CMS redirect → (handler) static rules.ts → SSR

| Adım | Dosya | Ne yapar |
|---|---|---|
| Auth | `server/middleware/steps/auth/` | Token oku/yenile, `Authorization` inject, cookie yaz |
| Session | `server/middleware/steps/session/` | gclid/utm/theme → cookie, tracking UUID, `x-pathname` |
| CMS redirect | `server/middleware/steps/redirection/` | GW redirect map, 410/301 terminal |
| Static routing | `src/routing/rules.ts` | Config redirect/rewrite/proxy |
| SSR loader | `src/services/*` + `gatewayFetch` | GW'ye token ile istek |

### Matcher (2 seviye)

1. **Hono mount** — `/assets/*`, `/healthz`, `/api/*` (internal hariç) pipeline'a girmez
2. **`shouldRunPipeline(pathname)`** — `_next`, static extensions, public API skip; `/api/internal/*` çalışır

### Loader + gateway sözleşmesi

Middleware `Authorization` header inject eder. Loader'da:

```ts
import { gatewayFetch } from "../../lib/gateway-fetch";
import { fetchUserProfile } from "../../services/user";

loader: async (ctx) => {
  const user = await fetchUserProfile(ctx.request); // GW + Bearer token
  return { data: { user } };
}
```

**Cache kuralı:** Token (veya kayıtlı bypass check) varsa HTML cache **BYPASS**; anonim ziyaretçi **shared cache** (HIT/MISS). Bypass kriterleri cache key'e girmez.

## HTML cache — `sharedUnlessBypass`

Tüm public route'lar [`src/lib/cache-policy.ts`](../src/lib/cache-policy.ts) kullanır:

```ts
import { sharedUnlessBypass, neverCache } from "../../lib/cache-policy";

// Standart sayfa — anonim cache'lenir, oturumlu BYPASS
cache: (ctx) => sharedUnlessBypass(ctx, ["page-id", ctx.publicPath, locale(ctx.request)]),

// Kişisel sayfa — hiç cache'lenmez (ör. hesabım)
cache: () => neverCache(),
```

| Ziyaretçi | x-cache | Davranış |
|---|---|---|
| Anonim | MISS → HIT | Paylaşılan HTML cache |
| Token / Authorization | BYPASS | Her istekte loader + render |
| `neverCache()` route | BYPASS | Her zaman |

### Esnek bypass registry

Bugün token; yarın PID veya başka kriter — global registry'ye ekle:

```ts
// server/index.ts veya src/bootstrap/cache.ts (app startup)
import { registerCacheBypassCheck, hasPid } from "../src/lib/cache-policy";

registerCacheBypassCheck(hasPid); // Cookie.pid doluysa BYPASS
```

Route-local override:

```ts
cache: (ctx) =>
  sharedUnlessBypass(ctx, ["special", ctx.publicPath], {
    bypass: (ctx) => cookie(ctx.request, "preview") === "1",
  }),
```

**Kurallar:**
- Bypass check'ler cache **key'e girmez** — sadece cache'e girip girmeme kararı verirler
- Kişisel veri cached HTML'de olmamalı; oturumlu isteklerde loader GW'den çeker
- `Cookie` isimleri: [`src/lib/cookies.ts`](../src/lib/cookies.ts)

### Internal BFF

`POST /api/internal/refresh` — token yenileme; pipeline bu path'te çalışır.

## Routing — rewrites, redirects, proxy

Next.js `rewrites()` / `redirects()` karşılığı: [`src/routing/rules.ts`](../src/routing/rules.ts)

| Next.js | ssr-kit | Davranış |
|---|---|---|
| `redirects()` | `redirects[]` | Tarayıcı URL değişir (301/308) |
| `rewrites()` (internal) | `rewrites[]` + `destination: "/internal-path"` | URL aynı kalır, route matcher internal path görür |
| `rewrites()` (external) | `rewrites[]` + `destination: "http://…"` | Proxy — istek backend/CDN'e iletilir |

**Pipeline sırası:** redirect → rewrite/proxy → route match → SSR

### Public URL vs internal path

- Route dosyasında **internal path** kullan: `path: "/retirement-banking"`
- Türkçe public URL için **rewrite** ekle: `{ source: "/emekli-bankaciligi", destination: "/retirement-banking" }`
- Cache key ve canonical URL için `ctx.publicPath` kullan (tarayıcıdaki path)
- Loader'da internal params için `ctx.url.pathname` ve `ctx.params`

```ts
// src/routing/rules.ts
export const rewrites = [
  { source: "/emekli-bankaciligi", destination: "/retirement-banking" },
  { source: "/basvuru/:page/yonlendirme", destination: "/recourse/:page/redirect" },
  { source: "/api/:path*", destination: `${GATEWAY_URL}/:path*` }, // proxy
];

export const redirects = [
  { source: "/eski-sayfa", destination: "/yeni-sayfa", status: 301 },
];
```

Pattern syntax: `:param` (tek segment), `:path*` (kalan path).

`server/api/internal/*` BFF route'ları rewrite'dan **önce** mount edilir — pipeline çalışır. Genel `/api/*` proxy rewrite ile GW'ye gider, pipeline atlanır.
