import { Cookie } from "~/lib/cookies";
import { cookie } from "~/lib/request";

import { forceTokenRefresh, withBffAuthCookies } from "./auth-bff";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Client-readable oturum durumu — httpOnly token'lar JS'te görünmez. */
export async function handleAuthSessionApi(request: Request): Promise<Response> {
  const signedIn = cookie(request, Cookie.signedIn) === "1";
  const displayName = cookie(request, Cookie.accountText);

  return json({
    signedIn,
    ...(displayName ? { displayName } : {}),
  });
}

export function mountAuthSessionApi(app: {
  get: (
    path: string,
    handler: (c: { req: { raw: Request } }) => Response | Promise<Response>,
  ) => void;
}): void {
  app.get("/api/internal/auth/session", (c) => handleAuthSessionApi(c.req.raw));
}

/** BFF token refresh — client TanStack / api-fetch 401 retry burayı çağırır. */
export async function handleRefresh(request: Request): Promise<Response> {
  const auth = await forceTokenRefresh(request);
  if (!auth.authorized) {
    return withBffAuthCookies(new Response(null, { status: 401 }), auth.cookies);
  }

  return withBffAuthCookies(json({ ok: true }), auth.cookies);
}
