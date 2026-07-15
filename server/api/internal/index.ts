import { applyCookies, CookieJar } from "@server/middleware/cookie-jar";
import type { AppVariables } from "@server/middleware/request-id";
import { mockRefresh, readTokens, setTokenCookies } from "@server/middleware/steps/auth/helpers";
import type { Hono } from "hono";

/** BFF token refresh — runs through pipeline on /api/internal/* paths. */
export async function handleRefresh(request: Request): Promise<Response> {
  const tokens = readTokens(request);
  if (!tokens.refresh) return new Response(null, { status: 401 });

  const refreshed = mockRefresh(tokens.refresh);
  const jar = new CookieJar();
  setTokenCookies(jar, refreshed.access, refreshed.refresh);

  const body = JSON.stringify({ ok: true });
  const res = applyCookies(
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    jar,
  );
  return res;
}

export function mountInternalApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/internal/refresh", (c) => handleRefresh(c.req.raw));
}
