---
name: data-loading
description: Use when fetching data for a page — wiring gateway/API calls, writing a route loader, or adding a server service in this OriginLoom app. Covers where data code lives, cache-safety, request cancellation, and validating untrusted responses.
---

# Data loading

## Where data code lives

- **Route `loader`** — the entry point. Runs on cache miss, may be async, returns
  `{ data }`. Keep it thin: call a service, shape the result, return it.
- **`server/services/`** — all gateway/API orchestration. Fetching, retries and
  response validation live here, not inline in routes. `server/services/shell-data.ts`
  is the example the generator ships.

The generated app has a `GATEWAY_URL` env but does not call it yet — wire your
upstream calls into `server/services/` and call them from loaders.

```ts
// server/services/housing-loans.ts
export async function getHousingLoans(signal: AbortSignal): Promise<LoanSummary[]> {
  const res = await fetch(`${config.gatewayUrl}/loans/housing`, { signal });
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  return parseLoanList(await res.json()); // validate — see below
}
```

```ts
// server/routes/housing-loans.tsx
loader: async (ctx) => ({ data: { items: await getHousingLoans(ctx.request.signal) } }),
```

## Rules

- **Pass `ctx.request.signal`** down to every fetch so a cancelled request tears
  down its I/O. Don't break the abort chain.
- **Loaders feed the shared cache**, so their data must be the same for every
  visitor. Nothing per-user (auth token, user id, personal content) belongs in the
  cached path — move that to a `defer` island (see **islands** and **caching**).
- **Validate untrusted responses; never trust a cast.** `await res.json()` is
  `unknown`. Check shape, string lengths, array sizes and number ranges in
  `server/services/` before returning. A `as SomeType` cast does not make gateway
  JSON safe.
- **Terminal results, not throws, for expected outcomes:** return `notFound()`,
  `redirect(...)` or `routeError(...)` from the loader (see **add-page**). A thrown
  exception renders the error boundary with `error: null` (the real message stays
  in the server log only).
