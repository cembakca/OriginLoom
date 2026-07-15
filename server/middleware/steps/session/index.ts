import { storeBotVisit } from "@server/middleware/api/bot-store";
import { sanitizeUuid, sanitizeValue } from "@server/middleware/sanitize";
import { cloneRequestWithHeaders } from "@server/middleware/sequential";
import type { MiddlewareStep } from "@server/middleware/types";
import { Cookie } from "@server/middleware/types";

import { cookie } from "~/lib/request";

const BOT_UA = /bot|crawl|spider|slurp|bingpreview/i;

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

export const sessionStep: MiddlewareStep = async (ctx, acc) => {
  const jar = acc.cookies;
  const url = ctx.url;

  const queryCookies: Array<[string, string | undefined]> = [
    [Cookie.gclid, sanitizeValue(url.searchParams.get("gclid"))],
    [Cookie.utmSource, sanitizeValue(url.searchParams.get("utm_source"))],
    [Cookie.utmCampaign, sanitizeValue(url.searchParams.get("utm_campaign"))],
    [Cookie.resource, sanitizeValue(url.searchParams.get("resource"))],
    [Cookie.theme, sanitizeValue(url.searchParams.get("theme"))],
  ];

  for (const [name, value] of queryCookies) {
    if (value) jar.set(name, value, { maxAge: 86_400 * 30 });
  }

  const trackingId =
    sanitizeUuid(cookie(acc.request, Cookie.userTrackingId)) ?? crypto.randomUUID();
  if (!cookie(acc.request, Cookie.userTrackingId)) {
    jar.set(Cookie.userTrackingId, trackingId, { maxAge: 86_400 * 365 });
  }

  const ua = acc.request.headers.get("user-agent") ?? "";
  const isBot = BOT_UA.test(ua);
  if (isBot) {
    jar.set(Cookie.botFlag, "1", { maxAge: 3600 });
    storeBotVisit({ pathname: ctx.publicPath, userAgent: ua, trackingId });
  }

  const headers = new Headers(acc.request.headers);
  headers.set("x-pathname", ctx.publicPath);
  headers.set("x-client-ip", clientIp(acc.request));

  const responseHeaders = new Headers(acc.responseHeaders);
  responseHeaders.set("x-tracking-id", trackingId);

  return {
    request: cloneRequestWithHeaders(acc.request, headers),
    cookies: jar,
    responseHeaders,
    trackingId,
  };
};
