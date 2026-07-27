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
  isShuttingDown: () => shuttingDown,
});
```

The platform never imports app code; everything it needs arrives through `installRuntime`.

## Main entries

| Entry                       | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `@originloom/core/app`      | `createApp` — the Hono application                              |
| `@originloom/core/runtime`  | `installRuntime`, `OriginRuntime`, `DocumentShell`              |
| `@originloom/core/cache`    | L1 memory + optional L2 Redis, cold-fill coalescing, SWR, purge |
| `@originloom/core/handler`  | The SSR request handler                                         |
| `@originloom/core/assets`   | Vite manifest / dev-server asset resolution                     |
| `@originloom/core/config`   | Env-driven config and its validation                            |
| `@originloom/core/document` | Document render orchestration (the renderer produces the HTML)  |
| `@originloom/core/metrics`  | Prometheus-style metrics + `/metrics` app                       |

Pipeline internals (`ssr/*`, `cache/cold-fill`, `middleware/pipeline`, …) are deliberately not
exported: they are free to change without a breaking release.
