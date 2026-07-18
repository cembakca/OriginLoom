import { config } from "@server/config";
import { isRequestDeadlineError } from "@server/middleware/request-deadline";

import type { Ctx } from "~/lib/types";

import type { HandleContext } from "./types";

export function createRouteContext(
  request: Request,
  url: URL,
  publicPath: string,
  params: Record<string, string>,
  ctx: HandleContext,
): Ctx {
  return {
    request,
    params,
    url,
    publicPath,
    siteUrl: config.siteUrl,
    ...(ctx.trackingId !== undefined ? { trackingId: ctx.trackingId } : {}),
    ...(ctx.cspNonce !== undefined ? { cspNonce: ctx.cspNonce } : {}),
  };
}

export function rethrowRequestDeadline(request: Request, error: unknown): void {
  if (isRequestDeadlineError(error)) throw error;
  if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
}
