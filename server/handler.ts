import { randomUUID } from "node:crypto";

import { match } from "~/lib/match";
import type { Route } from "~/lib/types";
import { normalizePublicUrl, resolveRoute } from "~/routing";

import type { Assets } from "./assets";
import * as cache from "./cache";
import { coalesceColdMiss } from "./cache/cold-fill";
import { scheduleRevalidation } from "./cache/revalidation";
import { stitchCachedHtml } from "./cache/stitch-fragments";
import { config } from "./config";
import { errorResponse } from "./error";
import { logError, logger } from "./logger";
import { setActiveHttpRoute, SpanKind, withSpan } from "./observability";
import { proxyRequest } from "./proxy";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "./public-url";
import { renderNotFoundDocument, renderRouteErrorDocument } from "./route-boundary";
import { createRouteContext, rethrowRequestDeadline } from "./ssr/context";
import { CacheFillTimeoutError, executeRoute, executeRouteWithBudget } from "./ssr/execute-route";
import {
  htmlResponse,
  loaderRedirectResponse,
  logRequest,
  normalizeErrorStatus,
} from "./ssr/response";
import type { HandleContext, RouteExecution } from "./ssr/types";

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
    const normalized = normalizePublicUrl(url);
    if (normalized.kind === "invalid") {
      logRequest(requestId, {
        path: url.pathname,
        status: 400,
        cache: "BYPASS",
        durationMs: Date.now() - started,
      });
      return publicUrlErrorResponse(requestId);
    }
    if (normalized.kind === "redirect") {
      logRequest(requestId, {
        path: url.pathname,
        status: 308,
        cache: "REDIRECT",
        durationMs: Date.now() - started,
      });
      return publicUrlRedirectResponse(normalized.location, requestId);
    }

    const resolution = resolveRoute(url, config.gatewayUrl);

    if (resolution.kind === "redirect") {
      logRequest(requestId, {
        path: url.pathname,
        status: resolution.status,
        cache: "REDIRECT",
        durationMs: Date.now() - started,
      });
      return Response.redirect(resolution.url, resolution.status);
    }

    if (resolution.kind === "proxy") {
      const proxied = await proxyRequest(request, resolution.url, ctx.clientIp);
      logRequest(requestId, {
        path: url.pathname,
        status: proxied.status,
        cache: "PROXY",
        durationMs: Date.now() - started,
      });
      if (requestId) proxied.headers.set("x-request-id", requestId);
      return proxied;
    }

    const internalUrl = new URL(url);
    internalUrl.pathname = resolution.pathname;
    if (resolution.kind === "rewrite") internalUrl.search = resolution.search;

    const m = match(routes, resolution.pathname);
    if (!m) {
      setActiveHttpRoute(request.method, "<unmatched>");
      const routeCtx = createRouteContext(request, internalUrl, resolution.publicPath, {}, ctx);
      const body = await withSpan("ssr.render.not_found", { kind: SpanKind.INTERNAL }, () =>
        renderNotFoundDocument(assets, routeCtx),
      );
      logRequest(requestId, {
        path: url.pathname,
        status: 404,
        cache: "BYPASS",
        durationMs: Date.now() - started,
      });
      return htmlResponse(body, 404, { kind: "none" }, "BYPASS", undefined, requestId);
    }

    const routeCtx = createRouteContext(request, internalUrl, resolution.publicPath, m.params, ctx);
    const { route } = m;
    setActiveHttpRoute(request.method, route.path);

    const validateParams = route.validateParams;
    if (
      validateParams &&
      !(await withSpan(
        "route.validate_params",
        { kind: SpanKind.INTERNAL, attributes: { "http.route": route.path } },
        async () => validateParams(routeCtx),
      ))
    ) {
      const body = await withSpan(
        "ssr.render.not_found",
        { kind: SpanKind.INTERNAL, attributes: { "http.route": route.path } },
        () => renderNotFoundDocument(assets, routeCtx, route),
      );
      logRequest(requestId, {
        path: url.pathname,
        status: 404,
        cache: "BYPASS",
        durationMs: Date.now() - started,
      });
      return htmlResponse(body, 404, { kind: "none" }, "BYPASS", undefined, requestId);
    }

    const policy = route.cache?.(routeCtx) ?? { kind: "none" as const };
    const key = cache.cacheKey(policy);

    if (key && request.method === "GET") {
      const hit = await cache.read(key);
      if (hit) {
        if (hit.state === "stale") {
          scheduleRevalidation(key, route, routeCtx, policy, assets, requestId);
        }
        const state = hit.state === "fresh" ? "HIT" : "STALE";
        logRequest(requestId, {
          path: url.pathname,
          status: 200,
          cache: state,
          durationMs: Date.now() - started,
        });
        const stitchedBody = await stitchCachedHtml(hit.body, route, routeCtx, true);
        return htmlResponse(stitchedBody, 200, policy, state, undefined, requestId);
      }
    }

    try {
      let execution: RouteExecution;
      if (key && request.method === "GET") {
        const coldMiss = await coalesceColdMiss({
          key,
          policy,
          work: async () => {
            const value = await executeRouteWithBudget(route, routeCtx, assets);
            const result = value.result;
            const terminal =
              result.kind && result.kind !== "data" ? true : (result.status ?? 200) !== 200;
            return {
              value,
              ...(value.body !== undefined ? { body: value.body } : {}),
              cacheable: !terminal,
              terminal,
            };
          },
          isTimeout: (error) => error instanceof CacheFillTimeoutError,
        });
        if (coldMiss.kind === "cache") {
          if (coldMiss.state === "STALE") {
            scheduleRevalidation(key, route, routeCtx, policy, assets, requestId);
          }
          logRequest(requestId, {
            path: url.pathname,
            status: 200,
            cache: coldMiss.state,
            durationMs: Date.now() - started,
          });
          const stitchedBody = await stitchCachedHtml(coldMiss.body, route, routeCtx, true);
          return htmlResponse(stitchedBody, 200, policy, coldMiss.state, undefined, requestId);
        }
        execution = coldMiss.work.value;
      } else {
        execution = await executeRoute(route, routeCtx, assets, "request");
      }
      const { result } = execution;

      if (result.kind === "redirect") {
        const status = result.status ?? 307;
        const response = loaderRedirectResponse(result, routeCtx.url, requestId);
        logRequest(requestId, {
          path: url.pathname,
          status,
          cache: "REDIRECT",
          durationMs: Date.now() - started,
        });
        return response;
      }

      if (result.kind === "notFound") {
        const body = await withSpan(
          "ssr.render.not_found",
          { kind: SpanKind.INTERNAL, attributes: { "http.route": route.path } },
          () => renderNotFoundDocument(assets, routeCtx, route),
        );
        logRequest(requestId, {
          path: url.pathname,
          status: 404,
          cache: "BYPASS",
          durationMs: Date.now() - started,
        });
        return htmlResponse(body, 404, { kind: "none" }, "BYPASS", result.headers, requestId);
      }

      if (result.kind === "error") {
        const status = normalizeErrorStatus(result.status);
        const errorId = randomUUID();
        logger.warn("route expected error", {
          errorId,
          requestId,
          path: url.pathname,
          route: route.path,
          status,
          code: result.error.code,
        });
        const body = await withSpan(
          "ssr.render.route_error",
          { kind: SpanKind.INTERNAL, attributes: { "http.route": route.path } },
          () => renderRouteErrorDocument(assets, routeCtx, route, result.error, status),
        );
        logRequest(requestId, {
          path: url.pathname,
          status,
          cache: "BYPASS",
          durationMs: Date.now() - started,
        });
        return htmlResponse(body, status, { kind: "none" }, "BYPASS", result.headers, requestId);
      }

      const body = execution.body;
      const streamResult = execution.streamResult;
      if (body === undefined && streamResult === undefined) {
        throw new Error("Route data result was not rendered");
      }

      const cacheState = key ? "MISS" : "BYPASS";
      logRequest(requestId, {
        path: url.pathname,
        status: result.status ?? 200,
        cache: cacheState,
        durationMs: Date.now() - started,
      });

      if (streamResult) {
        return htmlResponse(
          streamResult.stream,
          result.status ?? 200,
          policy,
          cacheState,
          result.headers,
          requestId,
        );
      } else {
        // Fresh shell fragments already contain current SSR output. Resolve
        // only fragments that opt into first-response stitching (for example,
        // public widgets with an independent cache policy).
        const stitchedBody = await stitchCachedHtml(body ?? "", route, routeCtx, false);
        return htmlResponse(
          stitchedBody,
          result.status ?? 200,
          policy,
          cacheState,
          result.headers,
          requestId,
        );
      }
    } catch (routeError) {
      rethrowRequestDeadline(request, routeError);
      const errorId = randomUUID();
      logError(routeError, {
        msg: "route execution failed",
        errorId,
        requestId,
        path: url.pathname,
        route: route.path,
      });
      const body = await withSpan(
        "ssr.render.route_error",
        { kind: SpanKind.INTERNAL, attributes: { "http.route": route.path } },
        () => renderRouteErrorDocument(assets, routeCtx, route, null, 500),
      );
      logRequest(requestId, {
        path: url.pathname,
        status: 500,
        cache: "ERROR",
        durationMs: Date.now() - started,
      });
      return htmlResponse(body, 500, { kind: "none" }, "ERROR", undefined, requestId);
    }
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
