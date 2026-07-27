/**
 * The server half of a browser session. Credentials stay in HttpOnly cookies —
 * the browser never holds a token — so every authenticated call goes through
 * here, where the cookie is exchanged for an `Authorization` header.
 *
 * Which gateway endpoint says who the user is, and what a profile looks like,
 * is the app's business; this module only carries credentials.
 */
import { Cookie } from "@originloom/shared/lib/cookies";

import { applyCookies, CookieJar } from "../middleware/cookie-jar.js";
import { runAuthCore } from "../middleware/steps/auth/core.js";
import {
  clearTokenCookies,
  displayNameFromAccess,
  readTokens,
  refreshTokens,
  setSessionCookies,
  setTokenCookies,
} from "../middleware/steps/auth/helpers.js";

export type BffAuthResult =
  | { kind: "authorized"; request: Request; cookies: CookieJar }
  | { kind: "unauthorized"; request: Request; cookies: CookieJar }
  | { kind: "unavailable"; request: Request; cookies: CookieJar };

/**
 * Resolves the caller's credentials for a BFF handler: refreshes an expired
 * access token when it can, and hands back a request carrying `Authorization`
 * so the gateway call downstream is a plain fetch.
 */
export async function authenticateBffRequest(request: Request): Promise<BffAuthResult> {
  const jar = new CookieJar();
  const outcome = await runAuthCore(request, jar);

  if (outcome.kind === "unavailable") return { kind: "unavailable", request, cookies: jar };
  if (!outcome.authorization) return { kind: "unauthorized", request, cookies: jar };

  const headers = new Headers(request.headers);
  headers.set("Authorization", outcome.authorization);

  return {
    kind: "authorized",
    request: new Request(request, { headers }),
    cookies: outcome.cookies,
  };
}

export function withBffAuthCookies(response: Response, jar: CookieJar): Response {
  return applyCookies(response, jar);
}

/** Synchronize client-readable hints only after an authoritative gateway response. */
export function confirmBffSession(jar: CookieJar, profile: { displayName: string }): void {
  setSessionCookies(jar, profile);
}

/** A gateway rejection invalidates both HttpOnly credentials and UI hints. */
export function rejectBffSession(jar: CookieJar): void {
  clearTokenCookies(jar);
}

/** Preserve refresh capability after an access-token challenge; clear only stale UI/access state. */
export function challengeBffSession(jar: CookieJar): void {
  jar.delete(Cookie.accessToken);
  jar.delete(Cookie.signedIn);
  jar.delete(Cookie.accountText);
}

/** After a client-side 401: mints a new access token from the refresh token. */
export async function forceTokenRefresh(request: Request): Promise<BffAuthResult> {
  const jar = new CookieJar();
  const tokens = readTokens(request);
  if (!tokens.refresh) {
    rejectBffSession(jar);
    return { kind: "unauthorized", request, cookies: jar };
  }

  const refreshed = await refreshTokens(tokens.refresh, request.signal);
  if (refreshed.kind === "unauthorized") {
    rejectBffSession(jar);
    return { kind: "unauthorized", request, cookies: jar };
  }
  if (refreshed.kind === "unavailable") return { kind: "unavailable", request, cookies: jar };

  setTokenCookies(jar, refreshed.access, refreshed.refresh);
  setSessionCookies(jar, { displayName: displayNameFromAccess(refreshed.access) });

  const headers = new Headers(request.headers);
  const bearer = refreshed.access.startsWith("Bearer ")
    ? refreshed.access
    : `Bearer ${refreshed.access}`;
  headers.set("Authorization", bearer);

  return {
    kind: "authorized",
    request: new Request(request, { headers }),
    cookies: jar,
  };
}
