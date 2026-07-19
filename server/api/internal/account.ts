import {
  authenticateBffRequest,
  challengeBffSession,
  confirmBffSession,
  withBffAuthCookies,
} from "@server/api/internal/auth-bff";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { fetchAccountSummary } from "@server/services/account";
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

/** Auth pipeline mantığı + cookie refresh — access expire ise otomatik yeniler. */
export async function handleAccountSummaryApi(request: Request): Promise<Response> {
  const auth = await authenticateBffRequest(request);
  if (auth.kind === "unavailable") {
    return withBffAuthCookies(json({ error: "Hesap servisi kullanılamıyor" }, 503), auth.cookies);
  }
  if (auth.kind === "unauthorized") {
    return withBffAuthCookies(json({ error: "Yetkisiz" }, 401), auth.cookies);
  }

  const result = await fetchAccountSummary(auth.request);
  if (result.kind === "unauthorized") {
    challengeBffSession(auth.cookies);
    return withBffAuthCookies(json({ error: "Yetkisiz" }, 401), auth.cookies);
  }
  if (result.kind === "unavailable") {
    return withBffAuthCookies(json({ error: "Hesap servisi kullanılamıyor" }, 503), auth.cookies);
  }

  confirmBffSession(auth.cookies, result.summary.profile);
  return withBffAuthCookies(json(result.summary), auth.cookies);
}

export function mountAccountApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/internal/account/summary", (c) => handleAccountSummaryApi(contextRequest(c)));
}
