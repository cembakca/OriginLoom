---
name: mutations
description: Use when adding anything that writes — a form, a POST/PUT/DELETE endpoint, a booking, a subscription, a like button, a file upload. Covers the same-origin guard, rate limiting, input validation, Post/Redirect/Get and why the result page is never cached. Read this before writing any handler that is not a GET.
---

# Mutations

The working example is the contact form: `/contact` posts to `POST /api/enquiries`, handled in
`server/api/enquiries.ts`, which calls `server/services/enquiries.ts`. Copy that shape.

## Every public write starts the same way

```ts
const ENQUIRY_POLICY: PublicApiPolicy = {
  name: "enquiry",
  windowMs: 60_000,
  globalLimit: 120, // protects the process
  ipLimit: 5, // stops one caller eating the budget
  requireSameOriginMutation: true, // the CSRF defence
};

export function mountEnquiryApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/enquiries", async (c) => {
    const request = contextRequest(c);
    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", ENQUIRY_POLICY);
    if (denied) return denied;
    // …
  });
}
```

`guardPublicApi` returns a ready `403`/`429` response or `null`. It is the first statement in the
handler — not after parsing, not after a lookup. Work done before the guard is work an attacker gets
for free.

A 403 in development usually means the origin does not match: `SITE_URL` is `http://127.0.0.1:3010`
and the browser is on `http://localhost:3010`. Same site to a human, different origin to the guard.

## Validate like the input is hostile, because it is

```ts
const name = trimmed(form.get("name"), 80);
const email = trimmed(form.get("email"), 160);
if (!name || !email || !EMAIL.test(email)) return seeOther(returnTo, "invalid");
```

Field by field, bounded length, shape checked. Nothing unvalidated reaches a service. A TypeScript
type is not a check — it describes what you hope arrived.

## Answer a browser form with a redirect

Post/Redirect/Get: return `303` with a `location`, never a rendered body. The visitor ends up on a
GET they can reload, share and go back to; without it, a refresh resubmits the form.

```ts
return new Response(null, {
  status: 303,
  headers: { location: `${returnTo}?status=sent`, "cache-control": "private, no-store" },
});
```

`returnTo` is a hidden field the page fills with its own path, validated to be a path on this site.
Hard-coding the destination breaks the moment the same form is served from a second path — a
localized route, for instance.

Machine clients are different: answer those with JSON and a real status code.

## The result page is never cached

Register it with `strategy: "never"` in `src/lib/cache-keys.ts`. A page that renders the outcome of
one visitor's write must never be served to the next.

Carry the outcome as a status the page maps through an allowlist, never by echoing the query string
into the HTML.

## No JavaScript required

The form is a plain `method="post" action="/api/…"`. It works before hydration, without hydration and
when the bundle fails. `e2e/ssr.no-js.spec.ts` proves it with JavaScript disabled. If you later add a
`fetch` submission, keep the form: enhancement layers on top, it does not replace.

## Checklist

1. `server/api/<name>.ts` with its own `PublicApiPolicy`; `guardPublicApi` first.
2. Validate every field with a length bound.
3. Upstream call in `server/services/<name>.ts`, budgeted through `GatewayContracts`.
4. `303` for browser forms, JSON for machine clients.
5. Mount it in `server/api/index.ts`.
6. `tests/<name>-api.test.ts`: cross-site rejection, invalid input, happy path, rate limit.
7. Result page `strategy: "never"`.
8. `pnpm ci`.

Full reference: `docs/mutations.md`.
