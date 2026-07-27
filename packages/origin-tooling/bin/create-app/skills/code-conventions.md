---
name: code-conventions
description: Use when writing or reviewing code in this OriginLoom app — folder layout, file and symbol naming, import rules and aliases, and the TypeScript conventions the linter enforces. Read before creating new files or moving code.
---

# Code conventions

## Folder layout

| Directory              | Holds                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `server/routes/`       | Route definitions (loader + cache + metadata + Component)                                   |
| `server/services/`     | Server-only data orchestration — gateway/API calls live here                                |
| `server/product/`      | The contract injected into the platform (runtime, renderer, document shell, boundary pages) |
| `src/features/<name>/` | Page components — task-focused, SSR-safe                                                    |
| `src/islands/`         | Client widgets only — auto-discovered by Vite glob                                          |
| `src/components/`      | Shared SSR-safe UI (no hooks, no browser APIs)                                              |
| `src/lib/`             | Product helpers, contracts, and the cache-key registry                                      |

## Naming

- Directories and files: **kebab-case** (`housing-loans`, `user-chrome.tsx`).
- Component exports: **PascalCase**; the file stays kebab-case.
- Service functions: **camelCase** (`getHousingLoans`, `getAccountSummary`).
- An island's file name must equal its `<Island name="…">`.

## Imports

- Reach the platform through `@originloom/core/*` (server runtime),
  `@originloom/react/*` (React: islands, views) and `@originloom/shared/*`
  (framework-neutral types, routing, metadata helpers).
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

- Code under `server/` and any `src/features/`/`src/components/` file renders on
  the server. No `window`, `document`, `localStorage`, `useState`, `useEffect`
  there — that belongs in an island.
- Never hand-write `JSON.stringify()` into JSX attributes to embed data; the
  platform's `<Island>` serializes props safely. Passing raw JSON into HTML is a
  correctness and XSS hazard.

## Checks before you call it done

```bash
pnpm typecheck
pnpm check:cycles   # no import cycles; core and react must not import each other
pnpm lint          # eslint (pnpm lint:fix to autofix); pnpm format for prettier
pnpm test
```

Or just run `/check`.

## Kendi env'ini eklemek

Platformun okuduğu değişkenler (port, cache, gateway, timeout) core'dadır. Bu
uygulamaya özgü olan her şey `server/product/config.ts`'te toplanır ve orada
doğrulanır:

```ts
export const productConfig = {
  catalogPageSize: numberEnv("CATALOG_PAGE_SIZE", 3),
} as const;

export function validateProductConfig(): void {
  assertPositiveInteger("CATALOG_PAGE_SIZE", productConfig.catalogPageSize);
}
```

`server/index.ts` bunu `validateConfig([validateProductConfig])` ile çağırır: hatalı
env, ilk isteği bekleyip orada patlamak yerine **başlangıçta** durdurur. Yeni bir
değişken eklerken `.env.development`'a da yorumuyla ekleyin.

## Public bir uç eklemek

İnternete açık her uç `guardPublicApi`'den geçmelidir (`server/api/items.ts`
örnektir):

```ts
const POLICY: PublicApiPolicy = {
  name: "items",
  windowMs: 60_000,
  globalLimit: 600, // process bütçesi
  ipLimit: 60, // tek çağıranın bu bütçeyi yemesini engeller
  requireSameOriginMutation: true, // cross-origin yazma = tarayıcıda CSRF denemesi
};

const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", POLICY);
if (denied) return denied;
```

İkisinden biri eksikse koruma yoktur: yalnız global limit tek bir çağıran
tarafından tüketilir, yalnız IP limiti ise dağıtık bir yükte işe yaramaz. Redis
varsa limitler pod'lar arasında paylaşılır, yoksa pod-local'dır.
