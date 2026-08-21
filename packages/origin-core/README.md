# @originloom/core

The server runtime of [OriginLoom](https://github.com/cembakca/OriginLoom): full-document SSR on
Hono, with a layered HTML cache, a request middleware pipeline, security, config and metrics.

**It has no UI framework in it** — no `react` dependency, no `.tsx`, not even a type import.
Rendering goes through the `OriginRenderer` contract in `@originloom/shared`, implemented by
`@originloom/react`.

```bash
pnpm add @originloom/core @originloom/shared
```

## Composition root

An app installs its runtime once, then hands `createApp` its route table:

```ts
import { createApp } from "@originloom/core/app";
import { readAssets } from "@originloom/core/assets";
import { installRuntime } from "@originloom/core/runtime";

installRuntime({
  renderer: productRenderer, // createReactRenderer(...) / createHtmlRenderer(...)
  fragments: productFragments,
  shell: shellDependencyPlan,
  isShellUsableForFragments: (shell) => Boolean(shell),
  document: productDocumentShell, // htmlLang, bot detection, metadata
  cacheKeys: { isKnownPageCachePrefix },
});

const app = createApp({
  assets: readAssets({ clientEntry: "/src/entry.client.tsx", eagerIslands: [] }),
  routes,
  mounts: { api: mountApi },
  middleware: productMiddleware, // the app's own request rules
  isShuttingDown: () => shuttingDown,
});
```

## Parallel shell dependencies

`OriginRuntime.shell` separates document chrome into four layers:

- `RequestFacts`: synchronous, bounded classification such as public path, locale and device class.
- `PublicShellSnapshot`: public I/O such as navigation or branding.
- `TargetedShell`: cache-safe projection of that snapshot for the request facts.
- `RequestOverlay`: request-private values used only by no-store request renders.

Public snapshot loading starts alongside the route loader. Targeting and composition are memoized for
the render, so fresh fragment stitching reuses the same work. Redirect, not-found and error outcomes
abort speculative public work; planned runtimes build their public terminal shell without waiting for
that dependency. Shared cache fills, revalidation and fragment rendering never receive
`RequestOverlay`, which keeps it structurally outside shared HTML.

Existing runtimes may continue to provide `buildShellData`; it remains supported as a deprecated
transition path. Because a legacy callback does not expose the four layers, the application remains
responsible for keeping its returned shell cache-safe.

## Composable document fragments

Fragments retain their own `ttl`, optional `swr`, cache key and timeout while the document keeps its
independent lifetime. Prefer `keyFromRequest(ctx)` when locale/device/version is enough to vary the
fragment: a fresh cache hit then avoids full shell work. Use legacy `key(shell, ctx)` only when key
correctness truly depends on shell data.

Cold fills use process-local and Redis coordination. A stale hit returns immediately and starts one
detached SWR refresh; active refreshes join graceful shutdown drain. Within one response, repeated
fragment names resolve once and all shell-dependent fragments share one shell promise. Cached page
entries retain compiled marker offsets, while marker-free HIT responses bypass composition entirely.

`timeoutMs` bounds shell plus resolver work and defaults to `FRAGMENT_TIMEOUT_MS` (2 seconds). An
explicit `fallback` is rendered uncached on error/timeout; without one, composition preserves the
HTML embedded inside the document marker. A fragment failure therefore does not fail the document.

## Product middleware

Cross-cutting request rules — maintenance, locale, tenant, experiments, a header on
every document — are the app's, so the platform takes them as a list rather than
guessing them:

```ts
import { defineMiddleware } from "@originloom/core/middleware";

export const localeMiddleware = defineMiddleware({
  name: "locale",
  phase: "before-render", // or "before-auth" to answer before any session work
  matcher: ["/products/:slug"], // optional
  handler: (ctx) => {
    const locale = ctx.cookie("locale") ?? "tr";
    return { requestHeaders: { "x-locale": locale }, values: { locale } };
  },
});
```

They run around the platform's own auth → session → redirect steps, never instead
of them. Values published this way reach loaders as `ctx.values`, and **fragment
the shared HTML cache by default** — a middleware that changes what a page renders
cannot leak one visitor's HTML to the next. Opt a value out with `cacheVary: []`
only when it provably cannot change the output.

The platform never imports app code; everything it needs arrives through `installRuntime`.

## Main entries

| Entry                                          | What it does                                                  |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `@originloom/core/app`                         | `createApp` — the Hono application                            |
| `@originloom/core/handler`                     | SSR request handler, revalidation drain                       |
| `@originloom/core/runtime`                     | `installRuntime`, `OriginRuntime`, `DocumentShell`, fragments |
| `@originloom/core/cache`                       | L1/L2 cache, topology, read/write, purge helpers              |
| `@originloom/core/cache/key-codec`             | Cache key registry encoding for purge/metrics                 |
| `@originloom/core/cache/resource`              | Typed data cache with SWR, negative TTL and stale-if-error    |
| `@originloom/core/middleware`                  | `defineMiddleware` — product request rules                    |
| `@originloom/core/middleware/cookie-jar`       | Cookie jar for BFF responses                                  |
| `@originloom/core/middleware/request-deadline` | API deadlines, `contextRequest`                               |
| `@originloom/core/middleware/request-id`       | `AppVariables` for typed Hono mounts                          |
| `@originloom/core/middleware/sanitize`         | UUID sanitization helpers                                     |
| `@originloom/core/middleware/security`         | CSP script hash registration                                  |
| `@originloom/core/adapters/gateway`            | Gateway fetch, identity, response release                     |
| `@originloom/core/gateway-payload`             | Payload budgets, `readGatewayJson`, contracts                 |
| `@originloom/core/gateway-transport`           | Shared gateway connection pool                                |
| `@originloom/core/auth/bff`                    | BFF session auth, refresh coordination                        |
| `@originloom/core/security/public-api-guard`   | Rate-limited public API guard                                 |
| `@originloom/core/api/client-errors`           | Client error ingestion mount                                  |
| `@originloom/core/api/client-metrics`          | Client metrics ingestion mount                                |
| `@originloom/core/api/cache-purge`             | Cache purge operations mount                                  |
| `@originloom/core/seo`                         | `mountSeoRoutes`, robots.txt, sitemap.xml                     |
| `@originloom/core/assets`                      | Vite manifest / dev-server asset resolution                   |
| `@originloom/core/media`                       | Responsive and unoptimized image helpers                      |
| `@originloom/core/config`                      | Env-driven config and validation                              |
| `@originloom/core/config-validation`           | Shared config assertion helpers                               |
| `@originloom/core/instrumentation`             | OpenTelemetry register/shutdown                               |
| `@originloom/core/observability`               | Tracing helpers (`memoizeRequestValue`, …)                    |
| `@originloom/core/logger`                      | Structured logging                                            |
| `@originloom/core/metrics`                     | Prometheus render/observe helpers                             |
| `@originloom/core/metrics-server`              | Operations listener (`/metrics`, mounts)                      |
| `@originloom/core/metrics/primitives`          | Product counter/gauge line builders                           |
| `@originloom/core/document`                    | Document render orchestration (renderer produces HTML)        |

The **`create-app` template contract** (Tier 1 supported surface) is listed in
[docs/export-surface.md](../../docs/export-surface.md). Showroom and tests may import additional
wildcard paths; consumer apps should stick to Tier 1.

Pipeline internals (`ssr/*`, `cache/cold-fill`, `middleware/pipeline`, …) are deliberately not
exported: they are free to change without a breaking release. See `public-api.test.ts` and
`export-surface.manifest.mjs`.

## Typed cached resources

Shared gateway/CMS data should use the typed resource API instead of manually combining
`cache.read`, `JSON.parse` and `cache.write`:

```ts
import { cachedResourceValue, defineCachedResource } from "@originloom/core/cache/resource";

const menu = defineCachedResource<Menu>({
  namespace: "menu",
  version: 1,
  ttl: 300,
  swr: 3600,
  staleIfError: 600,
  timeoutMs: 5000,
  tags: ["resource:menu"],
  parse: parseMenu, // validates and returns the normalized, shareable value
});

const result = await menu.get([device], async ({ signal }) =>
  cachedResourceValue(await fetchMenu(device, signal)),
);
```

Keys are type-tagged and versioned. Fresh values stay typed in process memory; Redis receives the
versioned serialized envelope. `not-found` and `no-content` are explicit successful outcomes and are
cached only when `negativeTtl` enables them. Loader exceptions are never converted into negative
entries. A caller may pass its request signal to `get`; this stops that caller waiting without
aborting shared fill or detached refresh work. Existing `drainRevalidations` also drains resource
refreshes during shutdown.

## Dependency tags and targeted invalidation

Shared page policies, typed resources and fragment definitions may declare stable string tags such
as `resource:menu`. The tag is stored in the Redis codec alongside the entry and indexed in the
process-local L1. Redis mode additionally maintains release-scoped, expiry-scored tag sets. Purging
that tag removes every dependent page/resource/fragment entry while leaving unrelated cache data
alone:

```ts
import { invalidateTags } from "@originloom/core/cache";

await invalidateTags(["resource:menu"]);
```

Exact-key and prefix invalidation remain available. Tag operations are intentionally bounded: at
most 16 tags per entry, 8 tags per operation, 500 indexed keys per tag and 2,048 distinct tags per
release/process. A write that would exceed index cardinality is rejected instead of creating an
entry that targeted purge cannot find.

With Redis enabled, invalidation is published on the release-specific Pub/Sub channel so every pod
drops matching L1 entries. A subscriber reconnect after a message gap flushes its complete L1 as a
safe recovery. Both entries (`ssr:<release>:`) and tag indices (`ssr-meta:<release>:tag:`) are scoped
by `RELEASE_ID`; rolling releases therefore do not invalidate each other's cache, and old release
state expires with its entries.

## L1 memory budgets

The process-local L1 is a byte-weighted LRU shared by `page`, `data`, `fragment` and `negative`
namespaces. `CACHE_L1_MAX_BYTES` is the global ceiling; every namespace also has a hard maximum and
a protected minimum reserve. Unused reserved space remains borrowable, but a competing namespace
cannot evict live entries below its reserve. Redis is an optional L2 and does not disable these L1
rules: every L2 promotion passes through the same admission policy.

Entry weight includes UTF-8 key/body bytes, fragment metadata, a conservative object overhead and,
when present, the typed in-memory resource value. `CACHE_MAX_ENTRIES` remains a second safety bound.
Oversized entries are rejected explicitly rather than briefly exceeding the configured ceiling.

| Setting                                                |                       Default |
| ------------------------------------------------------ | ----------------------------: |
| `CACHE_L1_MAX_BYTES`                                   |                       128 MiB |
| `CACHE_L1_{PAGE,DATA,FRAGMENT,NEGATIVE}_MAX_BYTES`     | 100%, 60%, 30%, 10% of global |
| `CACHE_L1_{PAGE,DATA,FRAGMENT,NEGATIVE}_RESERVE_BYTES` |   40%, 20%, 10%, 2% of global |
| `CACHE_L1_MAX_LOCKS`                                   |                         4,000 |
| `CACHE_L1_MAX_EPHEMERAL_VALUES`                        |                         2,000 |
| `CACHE_L1_MAX_RATE_LIMITS`                             |                        10,000 |

Expired cache entries, locks, ephemeral coordination values and rate-limit windows are removed by
an unref'ed nearest-deadline timer, including when no request traffic arrives. Prometheus exposes
current bytes/entries and eviction/rejection counters per namespace.
