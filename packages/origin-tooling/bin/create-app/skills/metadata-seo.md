---
name: metadata-seo
description: Use when working on page metadata, SEO, titles, canonical URLs, Open Graph / Twitter cards, robots, or JSON-LD in this OriginLoom app. Covers site defaults, per-route metadata, and how the document head is produced.
---

# Metadata & SEO

Metadata has two layers: **site-wide identity** (defaults) and **per-route
overrides**. The platform's metadata engine merges them and renders the `<head>`.

## Site defaults — `src/lib/metadata/site-defaults.ts`

`siteMetadata(baseUrl)` returns the `SiteMetadataConfig`: application name, the
title template (`"%s | Brand"`), description, Open Graph, Twitter, robots and
icons. It is installed once in `server/product/runtime.ts` via
`configureSiteMetadata({ site: siteMetadata })`. Change brand-wide SEO here.

## Per-route metadata — in `defineRoute`

- `title: () => "Sayfa Başlığı"` — the simple case (fills the title template).
- `generateMetadata: (data, ctx) => …` — the real SEO hook (canonical, robots,
  OG/Twitter overrides, route JSON-LD). **Feed it from the loader's `data`** — do
  not fetch again inside it.
- `pageMeta: (data, ctx) => defaultPageMeta(ctx, "page-type")` — GTM/analytics
  metadata, **not** SEO. Cache-safe fields only: never a tracking id or token.

```tsx
export default defineRoute<Data>({
  path: "/housing-loans/:slug",
  loader: async (ctx) => ({ data: await getLoan(ctx) }),
  generateMetadata: (data, ctx) => resolveLoanMetadata(data.seo, ctx),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "housing-loan-detail"),
  Component: LoanDetailPage,
});
```

## The document head — `server/product/document-shell.ts` + `renderer.tsx`

Resolving metadata and emitting it are separate files, because the core has no
UI framework:

- `document-shell.ts` (framework-free policy)
  - `resolveMetadata` → `resolveDocumentMetadata(route, data, ctx)` merges route
    metadata over the site defaults.
  - `boundaryMetadata` → `mergeMetadata(...)` produces 404/500 metadata.
- `renderer.tsx` (React views)
  - `renderHeadStart` → `<MetadataHead meta={seo} nonce={cspNonce} />` emits the
    actual `<meta>`/`<link>` tags with the CSP nonce.

You rarely edit these files; adjust metadata through the route and site defaults.

## robots.txt ve sitemap.xml — `server/seo.ts`

Both are mounted for you (`mounts: { seo: mountSeo }` in `server/index.ts`). The
platform owns the mechanics — headers, caching, XML escaping, degradation — and
this file owns the content:

```ts
mountPlatformSeoRoutes(app, {
  siteUrl: config.siteUrl,
  entries: (request) => fetchSitemapEntries(request),
  fallbackEntries: [{ path: "/" }, { path: "/catalog" }], // served when the source is down
});
```

The list is **asked for, not derived**. Building it from the first page of a
catalogue works until the catalogue is bigger than one page, and then it quietly
ships a sitemap missing most of the site — a failure with no error and no log
line. `server/services/sitemap.ts` asks the gateway and validates what comes
back: every entry must be a public path on this site, so an upstream mistake
cannot publish `//somebody-else.example/…` under this domain's authority.

`entries` receives the `Request` — it carries both the cancellation signal and
the gateway identity. If it throws, the fallback is served and the failure is
logged: a stale sitemap beats a 500 to a crawler. Add
`disallow: ["/api/", "/hesabim"]` to keep paths out of robots.txt.

## Rules

- **SEO meta ≠ analytics.** GTM/analytics scripts never go through
  `generateMetadata`; they live in the document head slots.
- Canonical and `og:url` stay on the `SITE_URL` origin. Don't build them from raw
  gateway URLs — validate/normalize untrusted URL fields first.
- Untrusted CMS/gateway SEO JSON is validated, not cast (see **data-loading**).
