import { authenticateBffRequest, withBffAuthCookies } from "@server/api/internal/auth-bff";

import { fetchAccountSummary } from "~/services/account";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Auth pipeline mantığı + cookie refresh — access expire ise otomatik yeniler. */
export async function handleAccountSummaryApi(request: Request): Promise<Response> {
  const auth = await authenticateBffRequest(request);
  if (!auth.authorized) {
    return withBffAuthCookies(json({ error: "Yetkisiz" }, 401), auth.cookies);
  }

  const summary = await fetchAccountSummary(auth.request);
  if (!summary) {
    return withBffAuthCookies(json({ error: "Yetkisiz" }, 401), auth.cookies);
  }

  return withBffAuthCookies(json(summary), auth.cookies);
}

export function mountAccountApi(app: {
  get: (
    path: string,
    handler: (c: { req: { raw: Request } }) => Response | Promise<Response>,
  ) => void;
}): void {
  app.get("/api/internal/account/summary", (c) => handleAccountSummaryApi(c.req.raw));
}
