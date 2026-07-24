import { parseTheme } from "@originloom/react/lib/content-values";
import { cookie } from "@originloom/react/lib/request";

import { tryGetRuntime } from "../../../runtime.js";
import { sanitizeUuid, sanitizeValue } from "../../sanitize.js";
import { cloneRequestWithHeaders } from "../../sequential.js";
import type { MiddlewareStep } from "../../types.js";
import { Cookie } from "../../types.js";

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

  const rawTrackingId = cookie(acc.request, Cookie.userTrackingId);
  const trackingId = sanitizeUuid(rawTrackingId) ?? crypto.randomUUID();
  if (!rawTrackingId || rawTrackingId !== trackingId) {
    jar.set(Cookie.userTrackingId, trackingId, { maxAge: 86_400 * 365 });
  }

  const ua = acc.request.headers.get("user-agent") ?? "";
  const isBot = BOT_UA.test(ua);
  if (isBot) {
    jar.set(Cookie.botFlag, "1", { maxAge: 3600 });
    tryGetRuntime()?.onBotVisit?.({ pathname: ctx.publicPath, userAgent: ua, trackingId });
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
