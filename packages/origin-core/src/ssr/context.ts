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

/**
 * The same request under a different cancellation signal.
 *
 * `new Request(request, { signal })` re-uses the source's body, which both
 * disturbs it and refuses outright once it has been read. Neither matters to
 * anything downstream of a render — the shell, a fragment and a cache stitch
 * read the URL and the headers, never the body — but a form action reads the
 * body first, and that made cloning a request the reason a submission could not
 * be parsed. Carrying the method and headers without the body keeps the signal
 * and drops the hazard.
 */
export function withRequestSignal(request: Request, signal: AbortSignal): Request {
  if (request.signal === signal) return request;
  if (!request.bodyUsed && request.body === null) return new Request(request, { signal });
  return new Request(request.url, { method: request.method, headers: request.headers, signal });
}

export function rethrowRequestDeadline(request: Request, error: unknown): void {
  if (isRequestDeadlineError(error)) throw error;
  if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
}
