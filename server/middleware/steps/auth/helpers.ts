import { cookie } from "../../../../src/lib/request";
import { Cookie } from "../../types";
import type { CookieJar } from "../../cookie-jar";

const REFRESH_COOLDOWN_MS = 5_000;
let lastRefreshAt = 0;
let refreshInFlight: Promise<{ access: string; refresh: string } | null> | null = null;

export function readTokens(request: Request): { access?: string; refresh?: string } {
  return {
    access: cookie(request, Cookie.accessToken),
    refresh: cookie(request, Cookie.refreshToken),
  };
}

/** Heuristic: treat malformed or expired JWT as needing refresh. */
export function isAccessTokenExpired(token: string | undefined): boolean {
  if (!token) return true;
  const parts = token.split(".");
  if (parts.length < 2) return true;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

export function setTokenCookies(jar: CookieJar, access: string, refresh: string): void {
  jar.set(Cookie.accessToken, access, { httpOnly: true, secure: true, maxAge: 3600 });
  jar.set(Cookie.refreshToken, refresh, { httpOnly: true, secure: true, maxAge: 86_400 });
}

export function clearTokenCookies(jar: CookieJar): void {
  jar.delete(Cookie.accessToken);
  jar.delete(Cookie.refreshToken);
}

export async function refreshTokens(
  refreshToken: string,
): Promise<{ access: string; refresh: string } | null> {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_COOLDOWN_MS && refreshInFlight) {
    return refreshInFlight;
  }

  lastRefreshAt = now;
  refreshInFlight = (async () => {
    try {
      const { gatewayFetch } = await import("../../api/gateway");
      const res = await gatewayFetch("/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!data.accessToken || !data.refreshToken) return null;

      return { access: data.accessToken, refresh: data.refreshToken };
    } catch {
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Dev/mock: derive a token from refresh cookie value when GW is down. */
export function mockRefresh(refreshToken: string): { access: string; refresh: string } {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: "user", exp })).toString("base64url");
  const access = `${header}.${payload}.mock`;
  return { access, refresh: refreshToken };
}
