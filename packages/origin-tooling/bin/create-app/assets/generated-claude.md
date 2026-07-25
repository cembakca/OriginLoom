# CLAUDE.md

This is a **thin OriginLoom product app**. The platform — cache, auth, middleware,
the SSR request pipeline, the island runtime and the metadata engine — comes from
`@originloom/core` and `@originloom/react` and is **consumed, never copied**. This
app owns its route table, its product contract, its pages and its chrome.

## Skills — use them

Detailed, task-specific guidance lives in `.claude/skills/`. Load the relevant one
before working; don't re-derive these patterns from scratch:

- `originloom-overview` — the platform/product split and the hard rules (start here)
- `add-page` — add a route/page (cache key → `defineRoute` → route table → feature)
- `caching` — the cache layer: registry, key rules, TTL/SWR, bypass
- `data-loading` — loaders, `server/services/`, gateway calls, cache-safety
- `islands` — client interactivity (`hydrate` vs `defer`)
- `metadata-seo` — titles, canonical, OG/Twitter, robots, JSON-LD
- `tailwind-styling` — Tailwind v4 and the `@source` gotcha
- `code-conventions` — folder layout, naming, imports, TypeScript
- `testing` — Vitest setup and what to test
- `/check` — run the local quality gate (typecheck, cycles, tests)

## Hard rules

1. Never copy platform code into this app. Missing capability = a platform change.
2. The platform never imports app code; everything is injected once via the
   `OriginRuntime` in `server/product/runtime.ts`.
3. App → platform imports use `@originloom/core/*` and `@originloom/react/*`.
   Inside the app use the `~/` (→ `src`) and `@server/` (→ `server`) aliases.
4. Cached HTML is shared across all visitors — never put per-user data in it. Use a
   `defer` island for anything personal.

## Commands

```bash
pnpm dev          # SSR + Vite dev server
pnpm typecheck    # tsc --noEmit
pnpm check:cycles # import-cycle / layering guard
pnpm lint         # eslint (pnpm lint:fix to autofix)
pnpm format       # prettier --write
pnpm test         # vitest run
pnpm build        # dist/client + dist/server/index.js
pnpm smoke        # boot the built server and probe /healthz
```
