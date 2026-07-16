import type { CookieJar } from "@server/middleware/cookie-jar";

import {
  clearTokenCookies,
  displayNameFromAccess,
  isAccessTokenExpired,
  readTokens,
  refreshTokens,
  setSessionCookies,
  setTokenCookies,
} from "./helpers";

export type AuthOutcome = {
  authorization?: string;
  cookies: CookieJar;
};

export async function runAuthCore(request: Request, jar: CookieJar): Promise<AuthOutcome> {
  const tokens = readTokens(request);
  let access = tokens.access;

  if (isAccessTokenExpired(access) && tokens.refresh) {
    const refreshed = await refreshTokens(tokens.refresh);
    if (!refreshed) {
      clearTokenCookies(jar);
      return { cookies: jar };
    }
    access = refreshed.access;
    setTokenCookies(jar, refreshed.access, refreshed.refresh);
    // A successful refresh is authoritative; synchronize the UI hint cookies.
    setSessionCookies(jar, { displayName: displayNameFromAccess(refreshed.access) });
  } else if (!access && !tokens.refresh) {
    clearTokenCookies(jar);
    return { cookies: jar };
  }

  if (!access) return { cookies: jar };

  return {
    authorization: access.startsWith("Bearer ") ? access : `Bearer ${access}`,
    cookies: jar,
  };
}
