---
name: add-page
description: Use when adding a new page or route to this OriginLoom app — any new URL that renders SSR HTML. Covers the cache-key registry entry, defineRoute (loader, cache, metadata, component), registering in the route table, and the feature component. Read the caching and islands skills for the details those steps reference.
---

# Add a page (route)

A route ties a URL to a loader, a cache policy and a component. The order below is
the order to do it in.

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

## 2. Write the route — `server/routes/<name>.tsx`

```tsx
import { defineRoute } from "@originloom/react/lib/types";

import { HousingLoansPage } from "~/features/housing-loans/housing-loans-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { items: LoanSummary[] };

export default defineRoute<Data>({
  path: "/housing-loans",
  cache: (ctx) => pageCachePolicy(PageCacheId.housingLoans, ctx),
  loader: async (ctx) => ({ data: { items: await getHousingLoans(ctx.request.signal) } }),
  title: () => "Konut Kredileri",
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "housing-loans"),
  Component: HousingLoansPage,
});
```

- `loader` runs on cache miss, may be async, returns `{ data }`.
- **Terminal results** (import from `@originloom/react/lib/types`) are explicit
  return values, not thrown errors — they never write to the shared cache:
  ```ts
  return notFound(); // → 404 view
  return redirect("/new-path", 308); // → Location response
  return routeError({ code: "X", message: "…" }, 422); // → ErrorComponent
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

## 4. Build the component — `src/features/<name>/<name>-page.tsx`

SSR-safe by default (no `useState`/`useEffect`/browser APIs). For interactivity,
drop an `<Island>` in — see the **islands** skill.

```tsx
export function HousingLoansPage({ data }: { data: { items: LoanSummary[] } }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Konut Kredileri</h1>
      {/* … */}
    </div>
  );
}
```
