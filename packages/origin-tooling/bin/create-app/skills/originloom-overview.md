---
name: originloom-overview
description: Read this first when working in this OriginLoom product app. Explains the platform/product split, the injection contract, and the hard rules about what this app owns versus what comes from @originloom/*. Use before adding a feature, refactoring, or whenever unsure where a piece of code belongs.
---

# Working in an OriginLoom app

This repository is a **thin product app** on top of the OriginLoom platform. The
platform — cache, auth, middleware, the SSR request pipeline and the metadata
engine — lives in `@originloom/shared`, `@originloom/core` and
`@originloom/react`. This app is **consumed, never copied**.

## What comes from the platform (never edit here, never copy in)

- Request → route → cache → loader → render pipeline
- L1/L2 cache, cold-fill coalescing, SWR revalidation, purge
- Auth/session middleware, CSP, request-id, metrics, `/healthz` + `/readyz`
- The document/SSR engine, island runtime, routing engine, metadata engine

Imported as `@originloom/core/*`, `@originloom/react/*` and `@originloom/shared/*`.
The core is framework-free: it renders through the `OriginRenderer` contract in
`@originloom/shared/render`, which `@originloom/react/server` implements.

## What this app owns

| Area                                                  | Where                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Route table                                           | `server/routes/`                                                                                                                         |
| Product contract given to the platform                | `server/product/runtime.ts` (`OriginRuntime`), `renderer.tsx` (React views), `document-shell.ts` (metadata policy), `boundary-pages.tsx` |
| Server-only data orchestration (gateway calls)        | `server/services/`                                                                                                                       |
| Composition root — wires runtime, routing, cache, app | `server/index.ts`                                                                                                                        |
| Page cache registry                                   | `src/lib/cache-keys.ts`                                                                                                                  |
| Page components                                       | `src/features/`                                                                                                                          |
| Client interactivity                                  | `src/islands/`                                                                                                                           |
| Chrome / layout                                       | `src/components/`, `src/styles/`                                                                                                         |
| Site identity / SEO defaults                          | `src/lib/metadata/site-defaults.ts`                                                                                                      |
| Redirect / rewrite rules                              | `src/routing/rules.ts`                                                                                                                   |

## Hard rules

1. **Never copy platform code into this app.** If something is missing from the
   platform, that is a platform change — do not fork `cache/`, `handler`, etc.
2. **The platform never imports app code.** Everything it needs is injected once,
   in `server/product/runtime.ts`, via the `OriginRuntime` contract. If you find
   yourself wanting the platform to know about a product concept, expose it
   through the runtime instead.
3. **Import boundaries:** the app reaches the platform through `@originloom/core/*`,
   `@originloom/react/*` and `@originloom/shared/*`. Inside the app use the `~/`
   (→ `src`) and `@server/` (→ `server`) aliases. The platform layering is
   `{core, react} → shared`: core and react never import each other, and neither
   core nor shared may touch React at all.

## Then use the focused skills

- Adding a page/route → **add-page**
- How a page is cached, cache keys, TTL/SWR, bypass → **caching**
- Client interactivity / hydration → **islands**
- Styling with Tailwind → **tailwind-styling**
- Folder layout, naming, imports, TS rules → **code-conventions**
