import { randomUUID } from "node:crypto";

import { match } from "@originloom/shared/lib/match";
import type { CachePolicy, Ctx, Route } from "@originloom/shared/lib/types";
import { normalizePublicUrl, resolveRoute } from "@originloom/shared/routing";

import * as cache from "../cache/index.js";
import { config } from "../config.js";
import { logError, logger } from "../logger.js";
import { setActiveHttpRoute } from "../observability.js";
import { proxyRequest } from "../proxy.js";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "../public-url.js";
import { applyMiddlewareCacheVary } from "./cache-vary.js";
import { createRouteContext, rethrowRequestDeadline } from "./context.js";
import { runLoader } from "./execute-route.js";
import {
  headResponse,
  loaderRedirectResponse,
  logRequest,
  normalizeErrorStatus,
} from "./response.js";
import type { HandleContext } from "./types.js";

export type ResolvedHeadRoute = {
  route: Route;
  routeCtx: Ctx;
  policy: CachePolicy;
  cacheKey: string | null;
  url: URL;
  started: number;
};

/** Resolves a HEAD request to either a terminal response or route context for cache/render. */
export async function resolveHeadRoute(
  request: Request,
  routeTable: Route[],
  ctx: HandleContext = {},
): Promise<Response | ResolvedHeadRoute> {
  const started = Date.now();
  const prepared = ctx.preparedRequest;
  const url = prepared?.url ?? new URL(request.url);

  const normalized = prepared?.normalized ?? normalizePublicUrl(url);
  if (normalized.kind === "invalid") return publicUrlErrorResponse(ctx.requestId);
  if (normalized.kind === "redirect") {
    return publicUrlRedirectResponse(normalized.location, ctx.requestId);
  }

  const resolution = prepared?.routing ?? resolveRoute(url, config.gatewayUrl);
  if (resolution.kind === "redirect") return Response.redirect(resolution.url, resolution.status);
  if (resolution.kind === "proxy") {
    const response = await proxyRequest(request, resolution.url, ctx.clientIp);
    if (ctx.requestId) response.headers.set("x-request-id", ctx.requestId);
    return response;
  }

  const internalUrl = new URL(url);
  internalUrl.pathname = resolution.pathname;
  if (resolution.kind === "rewrite") internalUrl.search = resolution.search;
  const matched = prepared ? prepared.matched : match(routeTable, resolution.pathname);
  if (!matched) return headResponse(404, { kind: "none" }, "BYPASS", undefined, ctx.requestId);

  setActiveHttpRoute("HEAD", matched.route.path);
  const routeCtx = createRouteContext(
    request,
    internalUrl,
    resolution.publicPath,
    matched.params,
    ctx,
  );
  if (matched.route.validateParams && !(await matched.route.validateParams(routeCtx))) {
    return headResponse(404, { kind: "none" }, "BYPASS", undefined, ctx.requestId);
  }

  const { route } = matched;
  const policy = applyMiddlewareCacheVary(route.cache?.(routeCtx) ?? { kind: "none" }, ctx);
  return {
    route,
    routeCtx,
    policy,
    cacheKey: cache.cacheKey(policy),
    url,
    started,
  };
}

/** Serves a cached HEAD response without acquiring render admission. */
export async function tryServeCachedHead(
  resolved: ResolvedHeadRoute,
  requestId: string | undefined,
): Promise<Response | null> {
  if (!resolved.cacheKey) return null;
  const hit = await cache.read(resolved.cacheKey);
  if (!hit) return null;

  const state = hit.state === "fresh" ? "HIT" : "STALE";
  const response = headResponse(200, resolved.policy, state, undefined, requestId);
  logRequest(requestId, {
    path: resolved.url.pathname,
    status: response.status,
    cache: state,
    durationMs: Date.now() - resolved.started,
  });
  return response;
}

/** Runs the loader path for HEAD after the cache fast path missed. */
export async function renderHeadRoute(
  resolved: ResolvedHeadRoute,
  requestId: string | undefined,
): Promise<Response> {
  const result = await runLoader(resolved.route, resolved.routeCtx, "request");
  if (result.kind === "redirect") {
    const response = loaderRedirectResponse(result, resolved.routeCtx.url, requestId);
    logOutcome(requestId, resolved.url, response.status, "REDIRECT", resolved.started);
    return response;
  }
  if (result.kind === "notFound") {
    const response = headResponse(404, { kind: "none" }, "BYPASS", result.headers, requestId);
    logOutcome(requestId, resolved.url, response.status, "BYPASS", resolved.started);
    return response;
  }
  if (result.kind === "error") {
    const status = normalizeErrorStatus(result.status);
    logger.warn("route expected error", {
      errorId: randomUUID(),
      requestId,
      path: resolved.url.pathname,
      route: resolved.route.path,
      status,
      code: result.error.code,
    });
    const response = headResponse(status, { kind: "none" }, "BYPASS", result.headers, requestId);
    logOutcome(requestId, resolved.url, response.status, "BYPASS", resolved.started);
    return response;
  }

  const state = resolved.cacheKey ? "MISS" : "BYPASS";
  const response = headResponse(
    result.status ?? 200,
    resolved.policy,
    state,
    result.headers,
    requestId,
  );
  logOutcome(requestId, resolved.url, response.status, state, resolved.started);
  return response;
}

/** Resolve the same route outcome as GET without rendering React or filling the HTML cache. */
export async function handleHead(
  request: Request,
  routeTable: Route[],
  ctx: HandleContext = {},
): Promise<Response> {
  const requestId = ctx.requestId;
  const url = ctx.preparedRequest?.url ?? new URL(request.url);

  try {
    const resolved = await resolveHeadRoute(request, routeTable, ctx);
    if (resolved instanceof Response) return resolved;
    const cached = await tryServeCachedHead(resolved, requestId);
    if (cached) return cached;
    return renderHeadRoute(resolved, requestId);
  } catch (error) {
    rethrowRequestDeadline(request, error);
    logError(error, { msg: "HEAD route resolution failed", requestId, path: url.pathname });
    return headResponse(500, { kind: "none" }, "ERROR", undefined, requestId);
  }
}

function logOutcome(
  requestId: string | undefined,
  url: URL,
  status: number,
  cacheState: string,
  started: number,
): void {
  logRequest(requestId, {
    path: url.pathname,
    status,
    cache: cacheState,
    durationMs: Date.now() - started,
  });
}
