import { gatewayFetch } from "@server/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@server/gateway-payload";
import type { CookieJar } from "@server/middleware/cookie-jar";
import { Cookie } from "@server/middleware/types";

import { cookie } from "~/lib/request";
import { isBoundedString, isRecord } from "~/lib/runtime-schema";
import { stripUndefined } from "~/lib/strip-undefined";

type RefreshResult = { access: string; refresh: string } | null;
type RefreshEntry = {
  promise: Promise<RefreshResult>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};

const refreshesInFlight = new Map<string, RefreshEntry>();
const INVALID_REFRESH = "Auth refresh gateway returned an invalid payload";

function useSecureCookies(): boolean {
  return (process.env.NODE_ENV ?? "development") === "production";
}

export function displayNameFromAccess(access: string): string {
  const parts = access.split(".");
  const payloadSegment = parts[1];
  if (!payloadSegment) return "Hesabım";

  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as {
      name?: string;
      sub?: string;
    };
    if (payload.name) return payload.name;
    if (payload.sub) return `User ${String(payload.sub).slice(-4)}`;
  } catch {
    // opaque token
  }

  const suffix = access.replace(/^Bearer\s+/i, "").slice(-4);
  return suffix ? `User ${suffix}` : "Hesabım";
}

export function readTokens(request: Request): { access?: string; refresh?: string } {
  return stripUndefined({
    access: cookie(request, Cookie.accessToken),
    refresh: cookie(request, Cookie.refreshToken),
  });
}

/** Heuristic: treat malformed or expired JWT as needing refresh. */
export function isAccessTokenExpired(token: string | undefined): boolean {
  if (!token) return true;
  const parts = token.split(".");
  if (parts.length < 2) return true;

  const payloadSegment = parts[1];
  if (!payloadSegment) return true;

  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

export function setTokenCookies(jar: CookieJar, access: string, refresh: string): void {
  const secure = useSecureCookies();
  jar.set(Cookie.accessToken, access, { httpOnly: true, secure, maxAge: 3600 });
  jar.set(Cookie.refreshToken, refresh, { httpOnly: true, secure, maxAge: 86_400 });
}

/** UI + client island'lar için okunabilir oturum cookie'leri (httpOnly değil). */
export function setSessionCookies(jar: CookieJar, profile: { displayName: string }): void {
  const secure = useSecureCookies();
  jar.set(Cookie.signedIn, "1", { secure, maxAge: 86_400 });
  jar.set(Cookie.accountText, profile.displayName, { secure, maxAge: 86_400 });
}

export function clearTokenCookies(jar: CookieJar): void {
  jar.delete(Cookie.accessToken);
  jar.delete(Cookie.refreshToken);
  jar.delete(Cookie.signedIn);
  jar.delete(Cookie.accountText);
}

export async function refreshTokens(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<RefreshResult> {
  const entry = refreshesInFlight.get(refreshToken) ?? createRefreshEntry(refreshToken);
  entry.waiters++;

  try {
    return await waitForRefresh(entry.promise, signal);
  } finally {
    entry.waiters = Math.max(0, entry.waiters - 1);
    if (entry.waiters === 0 && !entry.settled) {
      entry.controller.abort(signal ? abortReason(signal) : new Error("Refresh has no waiters"));
    }
  }
}

function createRefreshEntry(refreshToken: string): RefreshEntry {
  const controller = new AbortController();
  const entry = {
    controller,
    waiters: 0,
    settled: false,
  } as RefreshEntry;

  entry.promise = (async () => {
    try {
      const res = await gatewayFetch("/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      });
      if (!res.ok) return null;

      const payload = await readGatewayJson(res, "auth_refresh", INVALID_REFRESH);
      const data = requireGatewayPayload(
        "auth_refresh",
        payload,
        isRefreshPayload,
        INVALID_REFRESH,
      );
      return { access: data.accessToken, refresh: data.refreshToken };
    } catch {
      return null;
    } finally {
      entry.settled = true;
      if (refreshesInFlight.get(refreshToken) === entry) refreshesInFlight.delete(refreshToken);
    }
  })();
  refreshesInFlight.set(refreshToken, entry);
  return entry;
}

function waitForRefresh<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function isRefreshPayload(value: unknown): value is { accessToken: string; refreshToken: string } {
  return (
    isRecord(value) &&
    isBoundedString(value.accessToken, 16_384, 8) &&
    isBoundedString(value.refreshToken, 16_384, 8)
  );
}
