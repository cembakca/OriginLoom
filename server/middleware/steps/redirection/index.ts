import { lookupRedirect } from "@server/middleware/api/redirect-map";
import type { MiddlewareStep } from "@server/middleware/types";

import { mergeSearchParams } from "~/routing";

import { renderGonePage } from "./gone";

export const redirectionStep: MiddlewareStep = async (ctx, acc) => {
  const rule = await lookupRedirect(ctx.publicPath, acc.request.signal);
  if (!rule) return;

  if (rule.kind === "gone") {
    return {
      response: new Response(renderGonePage(), {
        status: 410,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      }),
    };
  }

  const dest = new URL(rule.destination, ctx.url.origin);
  dest.search = mergeSearchParams(ctx.url.searchParams, dest.searchParams);
  dest.hash = "";

  return {
    response: Response.redirect(dest.toString(), rule.status),
  };
};
