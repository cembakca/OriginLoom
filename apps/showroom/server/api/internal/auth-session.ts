import {
  authenticateBffRequest,
  challengeBffSession,
  confirmBffSession,
  forceTokenRefresh,
  rejectBffSession,
  withBffAuthCookies,
} from "@originloom/core/auth/bff";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { fetchUserProfileResult } from "@server/services/user";
import type { Hono } from "hono";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

const refreshPolicy: PublicApiPolicy = {
  name: "auth-refresh",
  windowMs: 60_000,
  globalLimit: 5_000,
  ipLimit: 120,
  requireSameOriginMutation: true,
};

/** Authoritative UI session: HttpOnly credentials + gateway profile decide the result. */
export async function handleAuthSessionApi(request: Request): Promise<Response> {
  const auth = await authenticateBffRequest(request);
  if (auth.kind === "unavailable") {
    return withBffAuthCookies(json({ error: "Oturum servisi kullanılamıyor" }, 503), auth.cookies);
  }
  if (auth.kind === "unauthorized") {
    rejectBffSession(auth.cookies);
    return withBffAuthCookies(json({ signedIn: false }, 401), auth.cookies);
  }

  const result = await fetchUserProfileResult(auth.request);
  if (result.kind === "unauthorized") {
    challengeBffSession(auth.cookies);
    return withBffAuthCookies(json({ signedIn: false }, 401), auth.cookies);
  }
  if (result.kind === "unavailable") {
    return withBffAuthCookies(json({ error: "Oturum servisi kullanılamıyor" }, 503), auth.cookies);
  }

  confirmBffSession(auth.cookies, result.profile);
  return withBffAuthCookies(
    json({
      signedIn: true,
      displayName: result.profile.displayName,
      initials: result.profile.initials,
    }),
    auth.cookies,
  );
}

export function mountAuthSessionApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/internal/auth/session", (c) => handleAuthSessionApi(contextRequest(c)));
}

/** BFF token refresh — client TanStack / api-fetch 401 retry burayı çağırır. */
export async function handleRefresh(request: Request, clientIp = "unresolved"): Promise<Response> {
  const denied = await guardPublicApi(request, clientIp, refreshPolicy);
  if (denied) return denied;
  const auth = await forceTokenRefresh(request);
  if (auth.kind === "unavailable") {
    return withBffAuthCookies(json({ error: "Oturum servisi kullanılamıyor" }, 503), auth.cookies);
  }
  if (auth.kind === "unauthorized") {
    return withBffAuthCookies(new Response(null, { status: 401 }), auth.cookies);
  }

  return withBffAuthCookies(json({ ok: true }), auth.cookies);
}
