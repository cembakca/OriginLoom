---
name: lists
description: Use when building or changing a page that lists things with filters, sorting or pagination — a catalogue, a search result, an archive, a table of records. Covers the query contract that keeps the loader and the cache key in agreement, which URLs are a 404 versus a redirect versus a default, and why filters are links.
---

# List pages

`server/routes/catalog.tsx` is the worked example. Copy its shape rather than
writing a list page from scratch — every line in it is there because of a failure
mode that only shows up in production.

## One query contract, two readers

The allowlist and the normalizers live in `src/lib/catalog-query.ts`. Two things
read them and they must agree:

- the **loader**, which turns a URL into a gateway request
- the **cache key** (`src/lib/cache-keys.ts` → `contentQuery`), which decides
  whether two URLs are the same page

Pass the _same object_, not a copy:

```ts
contentQuery: {
  include: [...CATALOG_QUERY],
  defaults: { category: "all", sortBy: "recommended", page: "1" },
  normalize: catalogNormalizers,
},
```

Two copies of the rule is how `?sortBy=newest` ends up serving the cached HTML of
`?sortBy=recommended`. There is a test that asserts they are the same reference.

A param outside the allowlist reaches neither the gateway nor the key — that is
what stops `utm_source` from writing hundreds of copies of identical HTML.

## Four URLs, four different answers

| URL                   | Answer       | Why                                              |
| --------------------- | ------------ | ------------------------------------------------ |
| `?category=nonsense`  | 200, default | Show the catalogue; an unknown filter is ignored |
| `?page=1`, `?page=01` | **308**      | A second name for the same page is a duplicate   |
| `?page=abc`           | **404**      | An address that was never valid                  |
| `?page=99` (of 3)     | **404**      | An empty 200 is a soft 404 — invisible in logs   |

`resolvePageParam` from `@originloom/shared/lib/content-values` separates the
first three; the route decides what each means. Clamping a bad page to 1 is the
tempting shortcut and it serves the catalogue under infinitely many addresses.

## Do not cache a URL that is about to 404 or redirect

```ts
cache: pageCache(PageCacheId.catalog, (ctx) =>
  resolvePageParam(ctx.url.searchParams.get("page")).kind === "valid"
    ? pageCachePolicy(PageCacheId.catalog, ctx)
    : neverCache(),
),
```

Otherwise one bad link fills the cache with copies of an error, under keys no
valid request will ever ask for.

## Filters are links

Every filtered view is a real URL: shareable, indexable, openable in a new tab,
and servable from the shared HTML cache. A `fetch`-and-replace filter is quicker
to write and gives up all four. Use `<Link>` with the `current` prop so the
active filter is announced, and build hrefs with `catalogHref`, which drops
defaults (`/catalog`, not `/catalog?category=all&sortBy=recommended&page=1`) and
resets the page when a filter changes.

## SEO text belongs to the gateway

`seoInfo` comes from upstream and is validated with `parseSeoInfo`. The route
adds only what it alone knows — which page of the sequence this is —
via `generatePaginatedMetadata`, which produces the canonical, `rel=prev/next`
and the numbered title. The `noindex` decision for thin or deep filtered pages is
the gateway's, not the route's.

## Checklist for a new list page

1. Query contract in `src/lib/<page>-query.ts`, normalizers exported.
2. Same normalizer object in the cache registry's `contentQuery`.
3. `resolvePageParam` triage in the loader: invalid → `notFound()`, redirect →
   `redirect(..., 308)`, valid → carry on.
4. Out-of-range page → `notFound()`.
5. `pageCache(id, resolver)` to keep invalid URLs out of the cache.
6. Filters rendered as `<Link>` with `current`.
7. Tests: allowlist, defaults, page reset on filter change, and the cache-key
   agreement.
