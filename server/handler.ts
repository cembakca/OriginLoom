import { randomUUID } from "node:crypto";

import { match } from "~/lib/match";
import type { Route } from "~/lib/types";
import { resolveRoute } from "~/routing";

import type { Assets } from "./assets";
import { config } from "./config";
import { errorResponse } from "./error";
import { logError } from "./logger";
import { rethrowRequestDeadline } from "./ssr/context";
import { resolveSsrRequest } from "./ssr/request-resolution";
import { logRequest } from "./ssr/response";
import { serveRoute } from "./ssr/serve-route";
import type { HandleContext } from "./ssr/types";

export { drainRevalidations } from "./cache/revalidation";
export { handleHead } from "./ssr/head";
export type { HandleContext } from "./ssr/types";

export function isSsrRouteRequest(request: Request, routeTable: Route[]): boolean {
  const resolution = resolveRoute(new URL(request.url), config.gatewayUrl);
  if (resolution.kind === "redirect" || resolution.kind === "proxy") return false;
  return match(routeTable, resolution.pathname) !== null;
}

export function methodNotAllowedResponse(requestId?: string): Response {
  const headers = new Headers({
    allow: "GET, HEAD",
    "cache-control": "private, no-store",
    "x-cache": "BYPASS",
  });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status: 405, headers });
}

/**
 * The whole request pipeline. Read it top to bottom — there is nothing else.
 *
 *   1. normalize browser-visible URL identity (308 or 400)
 *   2. resolve redirects / rewrites / proxy  (src/routing/rules.ts)
 *   3. match internal path → route
 *   4. cache → loader → render
 */
export async function handle(
  request: Request,
  routes: Route[],
  assets: Assets,
  ctx: HandleContext = {},
): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const requestId = ctx.requestId;

  try {
    const pendingResolution = resolveSsrRequest({
      request,
      routes,
      assets,
      context: ctx,
      started,
    });
    const resolved =
      pendingResolution instanceof Promise ? await pendingResolution : pendingResolution;
    if (resolved.kind === "response") return resolved.response;
    return await serveRoute({
      request,
      url,
      route: resolved.route,
      routeCtx: resolved.routeCtx,
      policy: resolved.policy,
      cacheKey: resolved.cacheKey,
      assets,
      requestId,
      started,
    });
  } catch (err) {
    rethrowRequestDeadline(request, err);
    const errorId = randomUUID();
    logError(err, { msg: "global request failure", errorId, requestId, path: url.pathname });
    logRequest(requestId, {
      path: url.pathname,
      status: 500,
      cache: "ERROR",
      durationMs: Date.now() - started,
    });
    const response = errorResponse(assets);
    if (requestId) response.headers.set("x-request-id", requestId);
    return response;
  }
}
