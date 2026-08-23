---
name: data-loading
description: Use when fetching data for a page — wiring gateway/API calls, writing a route loader, or adding a server service in this OriginLoom app. Covers where data code lives, cache-safety, request cancellation, and validating untrusted responses.
---

# Data loading

## Where data code lives

- **Route `loader`** — the entry point. Runs on cache miss, may be async, returns
  `{ data }`. Keep it thin: call a service, shape the result, return it.
- **`server/services/`** — all gateway/API orchestration. Fetching, contracts and
  response validation live here, not inline in routes. `server/services/items.ts`
  is the working example the generator ships.

Services take the **`Request`**, not a bare `AbortSignal`: it carries both the cancellation and the
identity every gateway call sends (tracking id, client IP, device). `gatewayFetchWithIdentity` is
the default; `gatewayFetchForRequest` adds the caller's `Authorization` and its result must never be
rendered into shared-cached HTML; plain `gatewayFetch` is for work with no request behind it.

Copy that shape:

```ts
// server/services/gateway-contracts.ts — this app's endpoints and their limits
export const GatewayContracts = {
  items: defineGatewayContract("items", 262_144),
  housingLoans: defineGatewayContract("housing_loans", 524_288), // ← yours
} as const;
```

```ts
// server/services/housing-loans.ts
import { gatewayFetch } from "@server/diagnostics/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";

const INVALID = "Housing loans gateway returned an invalid payload";

export async function getHousingLoans(signal: AbortSignal): Promise<LoanSummary[]> {
  const response = await gatewayFetch("/loans/housing", { signal });
  if (!response.ok) throw new Error(`Housing loans gateway returned ${response.status}`);

  const payload = await readGatewayJson(response, GatewayContracts.housingLoans, INVALID);
  return requireGatewayPayload(GatewayContracts.housingLoans, payload, isLoanList, INVALID);
}
```

```ts
// server/routes/housing-loans.tsx
loader: async (ctx) => ({ data: { items: await getHousingLoans(ctx.request.signal) } }),
```

`gatewayFetch` adds tracing, the correlation id and the gateway timeout.
`readGatewayJson` refuses a body larger than that contract's budget — an upstream
answering ten times its usual size is a defect, and reading it would be the
failure. `requireGatewayPayload` runs your guard and reports a rejection under
`ssr_gateway_invalid_payload_total{contract="…"}`.

**A 404 is data, not an error.** Return `null` from the service and let the route
turn it into `notFound()`; an exception would render the 500 page instead.

## Local gateway

`pnpm dev` starts `mock-gateway/server.mjs` alongside the app, so the pages work
before a real upstream exists. It is a fixture — fixed data in the shapes the real
gateway returns, not a second implementation of your backend. Point
`GATEWAY_URL` at the real thing when you have one.

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
