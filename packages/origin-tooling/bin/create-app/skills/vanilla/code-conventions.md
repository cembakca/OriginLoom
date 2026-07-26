---
name: code-conventions
description: Use when writing or reviewing code in this OriginLoom app — folder layout, file and symbol naming, import rules and aliases, and the TypeScript conventions the linter enforces. Read before creating new files or moving code.
---

# Code conventions

## Folder layout

| Directory             | Holds                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `server/routes/`      | Route definitions (loader + cache + metadata + Component)                                   |
| `server/services/`    | Server-only data orchestration — gateway/API calls live here                                |
| `server/product/`     | The contract injected into the platform (runtime, renderer, document shell, boundary pages) |
| `src/pages/<name>.ts` | Page functions — loader data in, HTML node out                                              |
| `src/islands/`        | Client modules only — auto-discovered by Vite glob                                          |
| `src/components/`     | Shared markup helpers (server-only, no browser APIs)                                        |
| `src/lib/`            | Product helpers, contracts, and the cache-key registry                                      |

## Naming

- Directories and files: **kebab-case** (`housing-loans`, `user-chrome.ts`).
- Page and component exports: **camelCase** functions (`housingLoansPage`); the
  file stays kebab-case.
- Service functions: **camelCase** (`getHousingLoans`, `getAccountSummary`).
- An island's file name must equal its `<Island name="…">`.

## Imports

- Reach the platform through `@originloom/core/*` (server runtime),
  `@originloom/vanilla/*` (`html`, `island`, the renderer) and
  `@originloom/shared/*` (types, routing, metadata helpers).
- Inside the app use the aliases: `~/` → `src`, `@server/` → `server`. Don't write
  long relative `../../..` chains.
- Keep imports grouped and sorted: node/external first, then `@originloom/*`, then
  `~/`/`@server/`. Separate type-only imports: `import type { Ctx } from "…"`.
  eslint (`simple-import-sort` + `consistent-type-imports`) enforces both — run
  `pnpm lint:fix` to sort/fix automatically.

## TypeScript

- `strict` is on. Avoid `any`. Model gateway JSON with real types and validate it
  in `server/services/` — a TypeScript cast does not make untrusted JSON safe.
- Prefer explicit return values over thrown control flow in loaders
  (`notFound()`, `redirect()`, `routeError()`).

## SSR safety

- Code under `server/` and any `src/pages/`/`src/components/` file renders on the
  server. No `window`, `document`, `localStorage` or timers there — that belongs
  in an island.
- Build markup with the `html` tag, which escapes every interpolated value. Use
  `raw()` only for markup you produced yourself, and never hand-write
  `JSON.stringify()` into an attribute — `island({ props })` serializes props
  safely.

## Checks before you call it done

```bash
pnpm typecheck
pnpm check:cycles   # no import cycles; the renderer and the core stay separate
pnpm lint          # eslint (pnpm lint:fix to autofix); pnpm format for prettier
pnpm test
```

Or just run `/check`.
