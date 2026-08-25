import { createHash } from "node:crypto";

import { sessionCookie } from "@originloom/shared/lib/request";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";
import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import { taintValueIfPossible } from "@originloom/shared/lib/taint";

import { gatewayFetch } from "../../../adapters/gateway.js";
import {
  acquireCoordinationLock,
  readCoordinationValue,
  releaseCoordinationLock,
  writeCoordinationValue,
} from "../../../cache/index.js";
import { config } from "../../../config.js";
import {
  defineGatewayContract,
  readGatewayJson,
  requireGatewayPayload,
} from "../../../gateway-payload.js";
import type { CookieJar } from "../../cookie-jar.js";
import { Cookie } from "../../types.js";
import { createRefreshCoordinationCodec } from "./refresh-coordination-crypto.js";
import type { RefreshResult } from "./refresh-result.js";

export type { RefreshResult } from "./refresh-result.js";
type RefreshEntry = {
  promise: Promise<RefreshResult>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};

const refreshesInFlight = new Map<string, RefreshEntry>();
const INVALID_REFRESH = "Auth refresh gateway returned an invalid payload";
/** Token refresh is the platform's own gateway call, so it owns this contract. */
const AUTH_REFRESH = defineGatewayContract("auth_refresh", 16_384);
const coordinationCodec = createRefreshCoordinationCodec(
  config.authRefreshCoordinationSecret,
  config.authRefreshCoordinationPreviousSecret,
);

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
    // Opaque token: nothing here is a name, and that is fine.
  }

  // Deliberately not derived from the token. This value lands in `account_text`,
  // which is readable by scripts by design — the header island reads it — so a
  // slice of the access token would put credential material on the far side of
  // the HttpOnly boundary this whole module exists to hold. A generic label
  // costs nothing: the real name arrives from the profile endpoint.
  return "Hesabım";
}

export function readTokens(request: Request): { access?: string; refresh?: string } {
  const tokens = stripUndefined({
    access: sessionCookie(request, Cookie.accessToken),
    refresh: sessionCookie(request, Cookie.refreshToken),
  });

  // Marked here rather than at each call site, because this is the one door the
  // tokens come through. If either ever reaches island props or JSON-LD, the
  // serializer refuses instead of shipping a credential inside shared HTML.
  // The marks are scoped to `tokens`, so they are forgotten with it.
  if (tokens.access) taintValueIfPossible("access token", tokens, tokens.access);
  if (tokens.refresh) taintValueIfPossible("refresh token", tokens, tokens.refresh);

  return tokens;
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
  jar.set(Cookie.accessToken, access, { httpOnly: true, maxAge: 3600 });
  jar.set(Cookie.refreshToken, refresh, { httpOnly: true, maxAge: 86_400 });
}

/** UI + client island'lar için okunabilir oturum cookie'leri (httpOnly değil). */
export function setSessionCookies(jar: CookieJar, profile: { displayName: string }): void {
  jar.set(Cookie.signedIn, "1", { maxAge: 86_400 });
  jar.set(Cookie.accountText, profile.displayName, { maxAge: 86_400 });
}

const AUTH_COOKIES = [
  Cookie.accessToken,
  Cookie.refreshToken,
  Cookie.signedIn,
  Cookie.accountText,
] as const;

/**
 * Whether the request carries any auth state at all. A visitor who sent none has
 * nothing to clear, and emitting Set-Cookie anyway would make every anonymous
 * response uncacheable — see `applyCookies`.
 */
export function hasAuthCookies(request: Request): boolean {
  // Through `sessionCookie` like every other read: during the migration a
  // visitor may hold either name, and a "has cookies" check that only knew one
  // of them would decide a signed-in visitor is anonymous.
  return AUTH_COOKIES.some((name) => sessionCookie(request, name) !== undefined);
}

export function clearTokenCookies(jar: CookieJar): void {
  for (const name of AUTH_COOKIES) jar.delete(name);
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
      return await coordinatedRefresh(refreshToken, controller.signal);
    } finally {
      entry.settled = true;
      if (refreshesInFlight.get(refreshToken) === entry) refreshesInFlight.delete(refreshToken);
    }
  })();
  refreshesInFlight.set(refreshToken, entry);
  return entry;
}

async function coordinatedRefresh(
  refreshToken: string,
  signal: AbortSignal,
): Promise<RefreshResult> {
  const key = `auth-refresh:${createHash("sha256").update(refreshToken).digest("base64url")}`;
  const existing = coordinationCodec.open(await readCoordinationValue(key));
  if (existing) return existing;

  const lock = await acquireCoordinationLock(key, config.authRefreshCoordinationTtlMs);
  if (lock.kind === "unavailable") return fetchRefreshResult(refreshToken, signal);
  if (lock.kind === "held") return waitForCoordinatedResult(key, refreshToken, signal);

  try {
    const afterLock = coordinationCodec.open(await readCoordinationValue(key));
    if (afterLock) return afterLock;
    const result = await fetchRefreshResult(refreshToken, signal);
    if (result.kind !== "unavailable") {
      await writeCoordinationValue(
        key,
        coordinationCodec.seal(result),
        config.authRefreshCoordinationTtlMs,
      );
    }
    return result;
  } finally {
    await releaseCoordinationLock(key, lock.token);
  }
}

async function waitForCoordinatedResult(
  key: string,
  refreshToken: string,
  signal: AbortSignal,
): Promise<RefreshResult> {
  const deadline = Date.now() + config.authRefreshCoordinationTtlMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw abortReason(signal);
    const result = coordinationCodec.open(await readCoordinationValue(key));
    if (result) return result;
    await abortableDelay(50, signal);
  }
  // Redis coordination is an availability optimization. If the owner died without publishing a
  // result, let the gateway make the authoritative decision after the bounded wait.
  return fetchRefreshResult(refreshToken, signal);
}

async function fetchRefreshResult(
  refreshToken: string,
  signal: AbortSignal,
): Promise<RefreshResult> {
  try {
    // Three ways out of this block, two of them without reading the body.
    // `await using` covers all three without a finally to keep in step.
    await using res = await gatewayFetch("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal,
    });
    if (res.status === 400 || res.status === 401) return { kind: "unauthorized" };
    if (!res.ok) return { kind: "unavailable" };

    const payload = await readGatewayJson(res, AUTH_REFRESH, INVALID_REFRESH);
    const data = requireGatewayPayload(AUTH_REFRESH, payload, isRefreshPayload, INVALID_REFRESH);
    return { kind: "success", access: data.accessToken, refresh: data.refreshToken };
  } catch {
    return { kind: "unavailable" };
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
