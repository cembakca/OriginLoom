import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  authenticateBffRequest,
  challengeBffSession,
  rejectBffSession,
  withBffAuthCookies,
} from "./auth/bff.js";
import type { CookieJar } from "./middleware/cookie-jar.js";

/**
 * The responses every BFF route ends in, written once.
 *
 * A BFF endpoint answers on behalf of a signed-in visitor, so its response is
 * private by definition — `no-store`, never a shared cache entry — and it has
 * to carry back whatever cookie changes the auth exchange produced. Both are
 * easy to forget on the fourth endpoint, and forgetting either is a leak: a
 * cached per-user payload, or a session that silently stops refreshing.
 *
 * These lived in every generated app as `server/lib/bff-{http,auth}.ts` and
 * were a copy in the exact sense that matters: pure infrastructure, no product
 * content, and stale the moment the template improved. They are here so an app
 * gets the fix by upgrading rather than by noticing.
 */

/**
 * The header pair every BFF answer carries. Exported so a handler can use
 * `c.json(body, status, BFF_HEADERS)` — which keeps RPC's type inference —
 * without restating the caching contract at each endpoint.
 */
export const BFF_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
} as const;

export function bffJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    // Per-user and never shared: no cache may keep this, at any layer.
    headers: { ...BFF_HEADERS },
  });
}

/** No usable session: 401 plus the cleared UI-hint cookies. */
export function bffSignedOut(cookies: CookieJar): Response {
  return withBffAuthCookies(bffJson({ signedIn: false }, 401), cookies);
}

/**
 * The session service itself is down. 503, not 401 — the visitor may well be
 * signed in, and answering "signed out" would sign them out of the UI over a
 * transient upstream failure.
 */
export function bffSessionUnavailable(cookies: CookieJar): Response {
  return withBffAuthCookies(bffJson({ error: "Oturum servisi kullanılamıyor" }, 503), cookies);
}

/**
 * Attaches the auth cookies without erasing what the response is.
 *
 * The generic matters for RPC: Hono infers the client's types from what a
 * handler returns, so widening a `c.json()` result to `Response` here would
 * hand the client an untyped body. `withBffAuthCookies` builds a new Response
 * with the same body and status, so preserving the type is accurate — the cast
 * only tells TypeScript what the runtime already guarantees.
 */
export function withBffCookies<T extends Response>(response: T, cookies: CookieJar): T {
  return withBffAuthCookies(response, cookies) as T;
}

/**
 * Ends the request with this exact response.
 *
 * Returning a bare `Response` from a handler would work at runtime and quietly
 * break the type contract: Hono infers the client's types from what handlers
 * return, and one untyped branch collapses the whole route's body type to
 * `{}`. Throwing keeps the happy path the only `return`, so the shape stays
 * inferable — and `app.onError` hands this response back untouched, headers,
 * cookies and all.
 */
export function halt(response: Response): never {
  throw new HTTPException(response.status as ContentfulStatusCode, { res: response });
}

export type BffGatewayContext = {
  gatewayRequest: Request;
  cookies: CookieJar;
  wasAuthorized: boolean;
};

/**
 * Read the request body *before* calling `resolveBffGatewayContext` or
 * `requireBffAuth`.
 *
 * Both rebuild the request to attach `Authorization`, and rebuilding consumes
 * the original body — a later `c.req.json()` on the incoming request fails
 * with "Body is unusable". Parse first, then authenticate, then send
 * `gatewayRequest` upstream.
 */

/**
 * A gateway-bound request for an endpoint that works signed in *or* out.
 *
 * Access is refreshed when the cookies allow it; when they do not, the original
 * request goes through unauthenticated rather than failing. Use this for public
 * data that is merely richer for a signed-in visitor.
 */
export async function resolveBffGatewayContext(request: Request): Promise<BffGatewayContext> {
  const auth = await authenticateBffRequest(request);
  if (auth.kind === "authorized") {
    return { gatewayRequest: auth.request, cookies: auth.cookies, wasAuthorized: true };
  }
  return { gatewayRequest: request, cookies: auth.cookies, wasAuthorized: false };
}

export type RequiredBffAuth =
  { ok: true; gatewayRequest: Request; cookies: CookieJar } | { ok: false; response: Response };

/**
 * A protected endpoint: no valid session means no answer.
 *
 * The three outcomes are distinct on purpose — `unavailable` is a 503 that
 * keeps the session, `unauthorized` clears the UI hints and returns 401.
 */
export async function requireBffAuth(request: Request): Promise<RequiredBffAuth> {
  const auth = await authenticateBffRequest(request);
  if (auth.kind === "unavailable") {
    return { ok: false, response: bffSessionUnavailable(auth.cookies) };
  }
  if (auth.kind === "unauthorized") {
    rejectBffSession(auth.cookies);
    return { ok: false, response: bffSignedOut(auth.cookies) };
  }
  return { ok: true, gatewayRequest: auth.request, cookies: auth.cookies };
}

/**
 * The gateway rejected a bearer this app believed was valid.
 *
 * The UI hints go, but the refresh token stays: the next call can still mint a
 * new access token, so this is a challenge, not a sign-out.
 */
export function bffGatewayUnauthorized(
  cookies: CookieJar,
  body: Record<string, unknown> = {},
): Response {
  challengeBffSession(cookies);
  return withBffCookies(bffJson({ signedIn: false, ...body }, 401), cookies);
}
