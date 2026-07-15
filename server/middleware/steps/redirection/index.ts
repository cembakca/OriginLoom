import { lookupRedirect } from "../../api/redirect-map";
import { storeBotVisit } from "../../api/bot-store";
import type { MiddlewareStep } from "../../types";
import { renderGonePage } from "./gone";

export const redirectionStep: MiddlewareStep = async (ctx, acc) => {
  const rule = await lookupRedirect(ctx.publicPath);
  if (!rule) return;

  const ua = acc.request.headers.get("user-agent") ?? "";
  if (/bot|crawl|spider/i.test(ua)) {
    storeBotVisit({ pathname: ctx.publicPath, userAgent: ua, trackingId: acc.trackingId });
  }

  if (rule.kind === "gone") {
    return {
      response: new Response(renderGonePage(), {
        status: 410,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      }),
    };
  }

  const dest = new URL(rule.destination, ctx.url.origin);
  dest.search = ctx.url.search;

  return {
    response: Response.redirect(dest.toString(), rule.status),
  };
};
