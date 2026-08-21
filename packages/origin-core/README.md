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
  buildShellData,
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
