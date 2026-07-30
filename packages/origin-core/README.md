# @originloom/core

The server runtime of [OriginLoom](https://github.com/cembakca/OriginLoom): full-document SSR on
Hono, with a layered HTML cache, a request middleware pipeline, security, config and metrics.

**It has no UI framework in it** — no `react` dependency, no `.tsx`, not even a type import.
Rendering goes through the `OriginRenderer` contract in `@originloom/shared`, implemented by
`@originloom/react` or `@originloom/vanilla`.

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

| Entry                         | What it does                                                     |
| ----------------------------- | ---------------------------------------------------------------- |
| `@originloom/core/app`        | `createApp` — the Hono application                               |
| `@originloom/core/middleware` | `defineMiddleware` — product request rules for document requests |
| `@originloom/core/runtime`    | `installRuntime`, `OriginRuntime`, `DocumentShell`               |
| `@originloom/core/cache`      | L1 memory + optional L2 Redis, cold-fill coalescing, SWR, purge  |
| `@originloom/core/handler`    | The SSR request handler                                          |
| `@originloom/core/assets`     | Vite manifest / dev-server asset resolution                      |
| `@originloom/core/config`     | Env-driven config and its validation                             |
| `@originloom/core/document`   | Document render orchestration (the renderer produces the HTML)   |
| `@originloom/core/metrics`    | Prometheus-style metrics + `/metrics` app                        |

Pipeline internals (`ssr/*`, `cache/cold-fill`, `middleware/pipeline`, …) are deliberately not
exported: they are free to change without a breaking release.
