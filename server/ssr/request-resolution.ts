import type { Assets } from "@server/assets";
import * as cache from "@server/cache";
import { config } from "@server/config";
import { setActiveHttpRoute, SpanKind, withSpan } from "@server/observability";
import { proxyRequest } from "@server/proxy";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "@server/public-url";
import { renderNotFoundDocument } from "@server/route-boundary";

import { match } from "@originloom/react/lib/match";
import type { CachePolicy, Ctx, Route } from "@originloom/react/lib/types";
import { normalizePublicUrl, resolveRoute } from "@originloom/react/routing";

import { createRouteContext } from "./context";
import { htmlResponse, logRequest } from "./response";
import type { HandleContext } from "./types";

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
  const url = new URL(request.url);
  const normalized = normalizePublicUrl(url);
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

  const resolution = resolveRoute(url, config.gatewayUrl);
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

  const matched = match(routes, resolution.pathname);
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
    return resolveValidatedRoute(route, routeCtx, assets, context.requestId, url, started);
  }
  return resolvedRoute(route, routeCtx);
}

async function resolveProxyResponse(
  request: Request,
  destination: string,
  publicUrl: URL,
  context: HandleContext,
  started: number,
): Promise<ResolvedSsrRequest> {
  const response = await proxyRequest(request, destination, context.clientIp);
  if (context.requestId) response.headers.set("x-request-id", context.requestId);
  logOutcome(context.requestId, publicUrl, response.status, "PROXY", started);
  return { kind: "response", response };
}

async function resolveValidatedRoute(
  route: Route,
  routeCtx: Ctx,
  assets: Assets,
  requestId: string | undefined,
  url: URL,
  started: number,
): Promise<ResolvedSsrRequest> {
  if (await validateParams(route, routeCtx)) return resolvedRoute(route, routeCtx);
  return resolveNotFoundResponse(assets, routeCtx, requestId, url, started, route);
}

function resolvedRoute(route: Route, routeCtx: Ctx): ResolvedSsrRequest {
  const policy = route.cache?.(routeCtx) ?? { kind: "none" as const };
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
