import type { Ctx } from "@originloom/shared/lib/types";

import { config } from "../config.js";
import { isRequestDeadlineError } from "../middleware/request-deadline.js";
import { isSafeRequestId } from "../middleware/request-id.js";
import type { HandleContext } from "./types.js";

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
    ...(ctx.requestId !== undefined && isSafeRequestId(ctx.requestId)
      ? { pageRequestId: ctx.requestId }
      : {}),
    ...(ctx.trackingId !== undefined ? { trackingId: ctx.trackingId } : {}),
    ...(ctx.cspNonce !== undefined ? { cspNonce: ctx.cspNonce } : {}),
    ...(ctx.values !== undefined ? { values: ctx.values } : {}),
  };
}

export function rethrowRequestDeadline(request: Request, error: unknown): void {
  if (isRequestDeadlineError(error)) throw error;
  if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
}
