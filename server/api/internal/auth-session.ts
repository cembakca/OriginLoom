import {
  authenticateBffRequest,
  challengeBffSession,
  confirmBffSession,
  forceTokenRefresh,
  rejectBffSession,
  withBffAuthCookies,
} from "@server/api/internal/auth-bff";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { fetchUserProfileResult } from "@server/services/user";
import type { Hono } from "hono";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Authoritative UI session: HttpOnly credentials + gateway profile decide the result. */
export async function handleAuthSessionApi(request: Request): Promise<Response> {
  const auth = await authenticateBffRequest(request);
  if (!auth.authorized) {
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
export async function handleRefresh(request: Request): Promise<Response> {
  const auth = await forceTokenRefresh(request);
  if (!auth.authorized) {
    return withBffAuthCookies(new Response(null, { status: 401 }), auth.cookies);
  }

  return withBffAuthCookies(json({ ok: true }), auth.cookies);
}
