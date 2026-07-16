import { storeBotVisit } from "@server/middleware/api/bot-store";
import { sanitizeUuid, sanitizeValue } from "@server/middleware/sanitize";
import { cloneRequestWithHeaders } from "@server/middleware/sequential";
import type { MiddlewareStep } from "@server/middleware/types";
import { Cookie } from "@server/middleware/types";

import { parseTheme } from "~/lib/content-values";
import { cookie } from "~/lib/request";

const BOT_UA = /bot|crawl|spider|slurp|bingpreview/i;

export const sessionStep: MiddlewareStep = async (ctx, acc) => {
  const jar = acc.cookies;
  const url = ctx.url;

  const queryCookies: Array<[string, string | undefined]> = [
    [Cookie.gclid, sanitizeValue(url.searchParams.get("gclid"))],
    [Cookie.utmSource, sanitizeValue(url.searchParams.get("utm_source"))],
    [Cookie.utmCampaign, sanitizeValue(url.searchParams.get("utm_campaign"))],
    [Cookie.resource, sanitizeValue(url.searchParams.get("resource"))],
    [
      Cookie.theme,
      url.searchParams.has("theme") ? parseTheme(url.searchParams.get("theme")) : undefined,
    ],
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
  headers.set("x-client-ip", ctx.clientIp);

  return {
    request: cloneRequestWithHeaders(acc.request, headers),
    cookies: jar,
    trackingId,
  };
};
