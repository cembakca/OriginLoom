---
name: middleware
description: Use when a request needs a rule that is not one page's concern — maintenance mode, locale or tenant resolution, feature flags and experiments, geo/bot gating, or a header on every HTML response. This is the Next.js middleware.ts equivalent in an OriginLoom app; it lives in server/middleware/ and is registered through createApp.
---

# Middleware

Cross-cutting request rules live in `server/middleware/`, one file per rule, and
are listed in `server/middleware/index.ts`. The list is passed to
`createApp({ middleware })` in `server/index.ts` — nothing else registers them.

The generator ships four working examples: `maintenance.ts` (a terminal 503 before
anything touches session state), `redirect-rules.ts` (asks the gateway what to do
with this URL, redirects or carries on), `experiments.ts` (an experiment bucket
that varies the cache and a campaign code that must not) and `search-indexing.ts`
(a response header off production).

Read `experiments.ts` before writing anything that returns `values`: every value
fragments the shared HTML cache by default, and the failure mode of forgetting
that is silent — the first visitor to miss the cache decides what everybody sees
for the whole TTL, and the experiment reports that both arms behave identically.

## Order

```
before-auth middleware → auth → session/tracking → CMS redirect → before-render middleware → routing rules → SSR
```

The platform's own steps are not in the app's list and cannot be reordered. A
middleware picks a side:

- `phase: "before-auth"` — turn the request away before tokens are refreshed or
  cookies are written: maintenance, tenant does not exist, country blocked.
- `phase: "before-render"` (default) — per-visitor decisions, `ctx.trackingId` is
  available: locale, experiment bucket, feature flags, response headers.

Within a phase, list order is run order.

## Writing one

```ts
import { defineMiddleware } from "@originloom/core/middleware";

export const experimentMiddleware = defineMiddleware({
  name: "experiment", // kebab-case, shows up in traces
  matcher: ["/", "/kampanya/:path*"], // optional; omit to run on every document request
  exclude: ["/api/:path*"], // optional denylist, checked first and wins over matcher
  handler: (ctx) => {
    const variant = ctx.cookie("variant") ?? (Math.random() < 0.5 ? "a" : "b");
    return {
      cookies: { variant: { value: variant, maxAge: 2_592_000 } },
      values: { variant },
    };
  },
});
```

Return `undefined` to do nothing. Otherwise return any of:

| Field             | Effect                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| `response`        | Terminal response — the route never runs                                    |
| `redirect`        | `"/giris"` or `{ location, status }` — `301/302/303/307/308`, default `307` |
| `requestHeaders`  | What loaders see; `null` deletes a header                                   |
| `responseHeaders` | Added to whatever response this request produces                            |
| `cookies`         | `"value"`, `{ value, maxAge, httpOnly, … }`, or `null` to delete            |
| `values`          | Readable as `ctx.values` in loaders, cache resolvers, later middleware      |
| `cacheVary`       | Which of those values fragment the shared HTML cache (default: all)         |

Cookie writes default to `Path=/` and `SameSite=Lax`. In production the core
forces `Secure` for sets, deletes, and merged jars even if middleware passes
`secure: false`.

## The cache rule — read this before publishing a value

Every entry in `values` fragments the shared HTML cache by default. A middleware
that changes what a page renders must not let one visitor's HTML be served to the
next; the default keeps that true without anyone remembering to think about it.

```ts
return { values: { variant } }; // renders differently → own cache entry
return { values: { campaign }, cacheVary: [] }; // analytics only → shared entry
```

`cacheVary: []` is a claim that the value cannot change the output. If a loader
renders it, the claim is wrong and the first visitor's page goes to everyone.

Buckets multiply cache entries: a two-way experiment doubles that page's entries.
Never publish an unbounded value (user id, search term) — that is a cache with one
entry per visitor.

## Boundaries

- Middleware runs on **document requests**. Routes mounted under `server/api/*`
  do not enter this pipeline — use Hono `app.use()` inside `server/api/index.ts`
  for those. An `/api/internal/*` path with no handler does fall through to the
  pipeline, so a middleware that calls anything needs `exclude: ["/api/:path*"]`.
- A middleware that calls a service runs on the request's own critical path.
  Narrow it with `matcher`, cache the answer, and fail open — `redirect-rules.ts`
  is the worked example.
- `authorization`, `cookie`, `x-pathname` and `x-client-ip` belong to the
  platform; writing them fails the request rather than silently winning.
- Use `cookies`, never a `set-cookie` response header.
- A throwing handler returns 500. It does not fail open. Catch what you expect to
  fail and fall back deliberately.
- Static redirects and rewrites belong in `src/routing/rules.ts`; CMS redirects
  are already handled by the platform. Do not reimplement either here.

## Checklist

1. New file in `server/middleware/`, exporting one `defineMiddleware({...})`.
2. Add it to the list in `server/middleware/index.ts`, in the order it must run.
3. Narrow it with `matcher` if it does not belong on every page.
4. If it publishes `values`, decide `cacheVary` deliberately and say why in a comment.
5. Add a case to `tests/middleware.test.ts` — the handler is a plain function.
6. `pnpm ci`.

Full reference: `docs/middleware.md`.
