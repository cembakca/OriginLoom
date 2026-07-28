---
name: add-page
description: Use when adding a new page or route to this OriginLoom app — any new URL that renders SSR HTML. Covers the cache-key registry entry, defineRoute (loader, cache, metadata, component), registering in the route table, and the page function. Read the caching and islands skills for the details those steps reference.
---

# Add a page (route)

A route ties a URL to a loader, a cache policy and a page function. The order
below is the order to do it in.

## 1. Give the page a cache identity — `src/lib/cache-keys.ts`

Route files never spell out cache keys inline; they derive them from the registry.
Add an id and a registry entry (skip only if the page is truly uncacheable — then
set `strategy: "never"`; see the **caching** skill).

```ts
export const PageCacheId = {
  home: "home",
  housingLoans: "housing-loans", // ← new
} as const;

export const pageCacheRegistry: Record<PageCacheId, PageCacheDefinition> = {
  // ...
  [PageCacheId.housingLoans]: {
    id: PageCacheId.housingLoans,
    description: "Konut kredileri listesi",
    path: "/housing-loans",
    strategy: "shared",
    ttl: 300,
    // Only normalized values that actually change the HTML belong in the key.
    buildKey: (ctx) => ["housing-loans", locale(ctx.request), layoutCacheFragment(ctx)],
  },
};
```

## 2. Write the route — `server/routes/<name>.ts`

```ts
import { defineRoute } from "@originloom/vanilla/lib/types";

import { housingLoansPage } from "~/pages/housing-loans";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { items: LoanSummary[] };

export default defineRoute<Data>({
  path: "/housing-loans",
  cache: (ctx) => pageCachePolicy(PageCacheId.housingLoans, ctx),
  loader: async (ctx) => ({ data: { items: await getHousingLoans(ctx.request.signal) } }),
  title: () => "Konut Kredileri",
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "housing-loans"),
  Component: housingLoansPage,
});
```

- `loader` runs on cache miss, may be async, returns `{ data }`.
- **Terminal results** (import from `@originloom/vanilla/lib/types`) are explicit
  return values, not thrown errors — they never write to the shared cache:
  ```ts
  return notFound(); // → 404 view
  return redirect("/new-path", 308); // → Location response
  return routeError({ code: "X", message: "…" }, 422); // → error view
  ```
- For real SEO (canonical, OG, JSON-LD) use `generateMetadata: (data, ctx) => …`
  instead of `title`; feed it from the loader's data, don't fetch again.
- Fetch data in `server/services/`, not inline in the route (see **code-conventions**).

## 3. Register it — `server/routes/index.ts`

```ts
import home from "./home";
import housingLoans from "./housing-loans";

// Order matters: the first match wins.
export const routes: Route[] = [home, housingLoans];
```

## 4. Build the page — `src/pages/<name>.ts`

A page is a function from loader data to an HTML node. `html` escapes every
interpolated value, so untrusted content is safe by default; reach for `raw()`
only for markup you produced yourself.

```ts
import { html } from "@originloom/vanilla/html";

export function housingLoansPage({ data }: { data: { items: LoanSummary[] } }) {
  return html`<div class="space-y-6">
    <h1 class="text-3xl font-bold tracking-tight text-slate-900">Konut Kredileri</h1>
    <ul>
      ${data.items.map((item) => html`<li>${item.name}</li>`)}
    </ul>
  </div>`;
}
```

Arrays are concatenated, and `null` / `undefined` / `false` render as nothing —
so `cond && html\`…\``works. For interactivity, drop an`island()` in; see the
**islands** skill.
