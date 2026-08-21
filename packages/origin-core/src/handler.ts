import { randomUUID } from "node:crypto";

import { match } from "@originloom/shared/lib/match";
import type { Route } from "@originloom/shared/lib/types";
import { resolveRoute } from "@originloom/shared/routing";

import type { Assets } from "./assets.js";
import { config } from "./config.js";
import { errorResponse } from "./error.js";
import { logError } from "./logger.js";
import type { PreparedRequest } from "./middleware/prepared-request.js";
import { rethrowRequestDeadline } from "./ssr/context.js";
import { type ResolvedSsrRequest, resolveSsrRequest } from "./ssr/request-resolution.js";
import { logRequest } from "./ssr/response.js";
import { serveRoute, type ServeRouteOptions, tryServeCachedRoute } from "./ssr/serve-route.js";
import type { HandleContext } from "./ssr/types.js";

export { drainRevalidations } from "./cache/revalidation.js";
export { handleHead, renderHeadRoute, resolveHeadRoute, tryServeCachedHead } from "./ssr/head.js";
export type { ServeRouteOptions } from "./ssr/serve-route.js";
export { tryServeCachedRoute } from "./ssr/serve-route.js";
export type { HandleContext } from "./ssr/types.js";

export type ResolvedHandleRequest =
  { kind: "response"; response: Response } | { kind: "route"; serveOptions: ServeRouteOptions };

/** Resolves a GET request to either a terminal response or route serve options. */
export async function resolveHandleRequest(
  request: Request,
  routes: Route[],
  assets: Assets,
  ctx: HandleContext = {},
): Promise<ResolvedHandleRequest> {
  const started = Date.now();
  const url = new URL(request.url);
  const pendingResolution = resolveSsrRequest({
    request,
    routes,
    assets,
    context: ctx,
    started,
  });
  const resolved: ResolvedSsrRequest =
    pendingResolution instanceof Promise ? await pendingResolution : pendingResolution;
  if (resolved.kind === "response") return resolved;
  return {
    kind: "route",
    serveOptions: {
      request,
      url,
      route: resolved.route,
      routeCtx: resolved.routeCtx,
      policy: resolved.policy,
      cacheKey: resolved.cacheKey,
      assets,
      requestId: ctx.requestId,
      started,
    },
  };
}

/** Serves a cached GET response when one exists. */
export async function tryCachedHandle(serveOptions: ServeRouteOptions): Promise<Response | null> {
  return tryServeCachedRoute(serveOptions);
}

/** Renders a GET request after the cache fast path missed. */
export async function renderHandle(serveOptions: ServeRouteOptions): Promise<Response> {
  return serveRoute({ ...serveOptions, skipCacheProbe: true });
}

export function isSsrRouteRequest(
  request: Request,
  routeTable: Route[],
  prepared?: PreparedRequest,
): boolean {
  if (prepared) return prepared.matched !== null;
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
    const resolved = await resolveHandleRequest(request, routes, assets, ctx);
    if (resolved.kind === "response") return resolved.response;
    const cached = await tryCachedHandle(resolved.serveOptions);
    if (cached) return cached;
    // Await inside the try so a renderer or route-boundary rejection reaches
    // the global error page instead of escaping the request handler.
    return await renderHandle(resolved.serveOptions);
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
    const response = errorResponse(assets, errorId, { pageRequestId: requestId });
    if (requestId) response.headers.set("x-request-id", requestId);
    return response;
  }
}
