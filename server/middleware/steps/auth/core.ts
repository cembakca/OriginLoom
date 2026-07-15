import type { CookieJar } from "../../cookie-jar";
import {
  clearTokenCookies,
  isAccessTokenExpired,
  mockRefresh,
  readTokens,
  refreshTokens,
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
    let refreshed = await refreshTokens(tokens.refresh);
    if (!refreshed) refreshed = mockRefresh(tokens.refresh);
    access = refreshed.access;
    setTokenCookies(jar, refreshed.access, refreshed.refresh);
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
