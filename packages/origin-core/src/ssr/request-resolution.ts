import { match } from "@originloom/shared/lib/match";
import type { CachePolicy, Ctx, Route } from "@originloom/shared/lib/types";
import { normalizePublicUrl, resolveRoute } from "@originloom/shared/routing";

import type { Assets } from "../assets.js";
import * as cache from "../cache/index.js";
import { config } from "../config.js";
import { setActiveHttpRoute, SpanKind, withSpan } from "../observability.js";
import { previewCachePolicy } from "../preview.js";
import { proxyRequest } from "../proxy.js";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "../public-url.js";
import { renderNotFoundDocument } from "../route-boundary.js";
import { applyMiddlewareCacheVary } from "./cache-vary.js";
import { createRouteContext } from "./context.js";
import { htmlResponse, logRouteOutcome as logOutcome } from "./response.js";
import type { HandleContext } from "./types.js";

export type ResolvedSsrRequest =
  | { kind: "response"; response: Response }
  | {
      kind: "route";
      route: Route;
      routeCtx: Ctx;
      policy: CachePolicy;
      cacheKey: string | null;
    };

type ResolveSsrRequestOptions = {
  request: Request;
  routes: Route[];
  assets: Assets;
  context: HandleContext;
  started: number;
};

export function resolveSsrRequest({
  request,
  routes,
  assets,
  context,
  started,
}: ResolveSsrRequestOptions): ResolvedSsrRequest | Promise<ResolvedSsrRequest> {
  const prepared = context.preparedRequest;
  const url = prepared?.url ?? new URL(request.url);
  const normalized = prepared?.normalized ?? normalizePublicUrl(url);
  if (normalized.kind === "invalid") {
    logOutcome(context.requestId, url, 400, "BYPASS", started);
    return { kind: "response", response: publicUrlErrorResponse(context.requestId) };
  }
  if (normalized.kind === "redirect") {
    logOutcome(context.requestId, url, 308, "REDIRECT", started);
    return {
      kind: "response",
      response: publicUrlRedirectResponse(normalized.location, context.requestId),
    };
  }

  const resolution = prepared?.routing ?? resolveRoute(url, config.gatewayUrl);
  if (resolution.kind === "redirect") {
    logOutcome(context.requestId, url, resolution.status, "REDIRECT", started);
    return { kind: "response", response: Response.redirect(resolution.url, resolution.status) };
  }
  if (resolution.kind === "proxy") {
    return resolveProxyResponse(request, resolution.url, url, context, started);
  }

  const internalUrl = new URL(url);
  internalUrl.pathname = resolution.pathname;
  if (resolution.kind === "rewrite") internalUrl.search = resolution.search;

  const matched = prepared ? prepared.matched : match(routes, resolution.pathname);
  if (!matched) {
    setActiveHttpRoute(request.method, "<unmatched>");
    const routeCtx = createRouteContext(request, internalUrl, resolution.publicPath, {}, context);
    return resolveNotFoundResponse(assets, routeCtx, context.requestId, url, started);
  }

  const { route } = matched;
  setActiveHttpRoute(request.method, route.path);
  const routeCtx = createRouteContext(
    request,
    internalUrl,
    resolution.publicPath,
    matched.params,
    context,
  );
  if (route.validateParams) {
    return resolveValidatedRoute(route, routeCtx, assets, context, url, started);
  }
  return resolvedRoute(route, routeCtx, context);
}

async function resolveProxyResponse(
  request: Request,
  destination: string,
  publicUrl: URL,
  context: HandleContext,
  started: number,
): Promise<ResolvedSsrRequest> {
  const response = await proxyRequest(request, destination, context.clientIp);
  logOutcome(context.requestId, publicUrl, response.status, "PROXY", started);
  return { kind: "response", response };
}

async function resolveValidatedRoute(
  route: Route,
  routeCtx: Ctx,
  assets: Assets,
  context: HandleContext,
  url: URL,
  started: number,
): Promise<ResolvedSsrRequest> {
  if (await validateParams(route, routeCtx)) return resolvedRoute(route, routeCtx, context);
  return resolveNotFoundResponse(assets, routeCtx, context.requestId, url, started, route);
}

function resolvedRoute(route: Route, routeCtx: Ctx, context: HandleContext): ResolvedSsrRequest {
  const declared = route.cache?.(routeCtx) ?? { kind: "none" as const };
  // Preview downgrades the policy before the key exists, so a draft render has
  // nothing to read from and nothing to write to. Doing it here rather than in
  // each route is the point: a route cannot forget.
  const policy = previewCachePolicy(applyMiddlewareCacheVary(declared, context), routeCtx.request);
  return { kind: "route", route, routeCtx, policy, cacheKey: cache.cacheKey(policy) };
}

async function resolveNotFoundResponse(
  assets: Assets,
  routeCtx: Ctx,
  requestId: string | undefined,
  url: URL,
  started: number,
  route?: Route,
): Promise<ResolvedSsrRequest> {
  const body = await renderNotFound(assets, routeCtx, route);
  logOutcome(requestId, url, 404, "BYPASS", started);
  return {
    kind: "response",
    response: htmlResponse(body, 404, { kind: "none" }, "BYPASS", undefined, requestId),
  };
}

async function validateParams(route: Route, routeCtx: Ctx): Promise<boolean> {
  return withSpan(
    "route.validate_params",
    { kind: SpanKind.INTERNAL, attributes: { "http.route": route.path } },
    async () => route.validateParams!(routeCtx),
  );
}

function renderNotFound(assets: Assets, routeCtx: Ctx, route?: Route): Promise<string> {
  return withSpan(
    "ssr.render.not_found",
    {
      kind: SpanKind.INTERNAL,
      ...(route ? { attributes: { "http.route": route.path } } : {}),
    },
    () => renderNotFoundDocument(assets, routeCtx, route),
  );
}
