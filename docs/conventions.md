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
4. Per-user data: use `mode="defer"` and fetch from `/api/*`

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

`server/api/*` route'ları rewrite'dan **önce** mount edilir — `/api/me` gibi SSR-kit API'leri proxy'ye düşmez.
