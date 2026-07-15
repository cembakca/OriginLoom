import { applyCookies, CookieJar } from "@server/middleware/cookie-jar";
import { runAuthCore } from "@server/middleware/steps/auth/core";
import {
  displayNameFromAccess,
  mockRefresh,
  readTokens,
  refreshTokens,
  setSessionCookies,
  setTokenCookies,
} from "@server/middleware/steps/auth/helpers";

export type BffAuthResult = {
  request: Request;
  cookies: CookieJar;
  authorized: boolean;
};

/** Internal BFF handler'ları için — access expire ise refresh dener, Authorization inject eder. */
export async function authenticateBffRequest(request: Request): Promise<BffAuthResult> {
  const jar = new CookieJar();
  const outcome = await runAuthCore(request, jar);

  if (!outcome.authorization) {
    return { request, cookies: jar, authorized: false };
  }

  const headers = new Headers(request.headers);
  headers.set("Authorization", outcome.authorization);

  return {
    request: new Request(request, { headers }),
    cookies: outcome.cookies,
    authorized: true,
  };
}

export function withBffAuthCookies(response: Response, jar: CookieJar): Response {
  return applyCookies(response, jar);
}

/** Client 401 sonrası — refresh_token ile yeni access üretir. */
export async function forceTokenRefresh(request: Request): Promise<BffAuthResult> {
  const jar = new CookieJar();
  const tokens = readTokens(request);
  if (!tokens.refresh) {
    return { request, cookies: jar, authorized: false };
  }

  let refreshed = await refreshTokens(tokens.refresh);
  if (!refreshed) refreshed = mockRefresh(tokens.refresh);

  setTokenCookies(jar, refreshed.access, refreshed.refresh);
  setSessionCookies(jar, { displayName: displayNameFromAccess(refreshed.access) });

  const headers = new Headers(request.headers);
  const bearer = refreshed.access.startsWith("Bearer ")
    ? refreshed.access
    : `Bearer ${refreshed.access}`;
  headers.set("Authorization", bearer);

  return {
    request: new Request(request, { headers }),
    cookies: jar,
    authorized: true,
  };
}
