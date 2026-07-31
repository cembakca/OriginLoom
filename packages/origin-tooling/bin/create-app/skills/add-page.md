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

## 5. Pick the right neighbour to copy

The generator ships a worked example for each shape a page tends to take. Copy
the one that matches rather than starting from a blank route:

| Shape                                   | Copy                                 | Skill / doc              |
| --------------------------------------- | ------------------------------------ | ------------------------ |
| Filtered, sorted, paginated list        | `server/routes/catalog.tsx`          | **lists**                |
| Detail page keyed by a slug             | `server/routes/item-detail.tsx`      | this skill + **caching** |
| Param whose valid values live upstream  | `server/routes/catalog-category.tsx` | `docs/route-params.md`   |
| Personal page (never shared-cached)     | `server/routes/account.tsx`          | **auth**, **islands**    |
| Form that writes something              | `server/routes/contact.tsx`          | **mutations**            |
| Slow upstream, shell first              | `server/routes/live.tsx`             | `docs/streaming.md`      |
| Nothing cached anywhere, for comparison | `server/routes/no-cache.tsx`         | **caching**              |

Two rules those examples encode and a new page usually forgets:

- **A URL heading for a 404 or a redirect must not be cached.** `pageCache` takes
  a resolver for exactly this; see `catalog.tsx`.
- **Streaming and shared caching are mutually exclusive.** A cache entry is the
  finished document, so a shared-cached route has nothing to stream. Decide which
  one the page needs before writing it.
