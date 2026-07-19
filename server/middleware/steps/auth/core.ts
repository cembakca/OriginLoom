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
  kind: "authorized" | "anonymous" | "unavailable";
  authorization?: string;
  cookies: CookieJar;
};

export async function runAuthCore(request: Request, jar: CookieJar): Promise<AuthOutcome> {
  const tokens = readTokens(request);
  let access = tokens.access;

  if (isAccessTokenExpired(access) && tokens.refresh) {
    const refreshed = await refreshTokens(tokens.refresh, request.signal);
    if (refreshed.kind === "unauthorized") {
      clearTokenCookies(jar);
      return { kind: "anonymous", cookies: jar };
    }
    if (refreshed.kind === "unavailable") return { kind: "unavailable", cookies: jar };
    access = refreshed.access;
    setTokenCookies(jar, refreshed.access, refreshed.refresh);
    // A successful refresh is authoritative; synchronize the UI hint cookies.
    setSessionCookies(jar, { displayName: displayNameFromAccess(refreshed.access) });
  } else if (!access && !tokens.refresh) {
    clearTokenCookies(jar);
    return { kind: "anonymous", cookies: jar };
  }

  if (!access) return { kind: "anonymous", cookies: jar };

  return {
    kind: "authorized",
    authorization: access.startsWith("Bearer ") ? access : `Bearer ${access}`,
    cookies: jar,
  };
}
