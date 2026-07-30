import { randomUUID } from "node:crypto";

import { match } from "@originloom/shared/lib/match";
import type { Route } from "@originloom/shared/lib/types";
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

/** Resolve the same route outcome as GET without rendering React or filling the HTML cache. */
export async function handleHead(
  request: Request,
  routeTable: Route[],
  ctx: HandleContext = {},
): Promise<Response> {
  const started = Date.now();
  const prepared = ctx.preparedRequest;
  const url = prepared?.url ?? new URL(request.url);
  const requestId = ctx.requestId;

  try {
    const normalized = prepared?.normalized ?? normalizePublicUrl(url);
    if (normalized.kind === "invalid") return publicUrlErrorResponse(requestId);
    if (normalized.kind === "redirect") {
      return publicUrlRedirectResponse(normalized.location, requestId);
    }

    const resolution = prepared?.routing ?? resolveRoute(url, config.gatewayUrl);
    if (resolution.kind === "redirect") return Response.redirect(resolution.url, resolution.status);
    if (resolution.kind === "proxy") {
      const response = await proxyRequest(request, resolution.url, ctx.clientIp);
      if (requestId) response.headers.set("x-request-id", requestId);
      return response;
    }

    const internalUrl = new URL(url);
    internalUrl.pathname = resolution.pathname;
    if (resolution.kind === "rewrite") internalUrl.search = resolution.search;
    const matched = prepared ? prepared.matched : match(routeTable, resolution.pathname);
    if (!matched) return headResponse(404, { kind: "none" }, "BYPASS", undefined, requestId);

    setActiveHttpRoute("HEAD", matched.route.path);
    const routeCtx = createRouteContext(
      request,
      internalUrl,
      resolution.publicPath,
      matched.params,
      ctx,
    );
    if (matched.route.validateParams && !(await matched.route.validateParams(routeCtx))) {
      return headResponse(404, { kind: "none" }, "BYPASS", undefined, requestId);
    }
    const { route } = matched;
    const policy = applyMiddlewareCacheVary(route.cache?.(routeCtx) ?? { kind: "none" }, ctx);
    const key = cache.cacheKey(policy);

    if (key) {
      const hit = await cache.read(key);
      if (hit) {
        const state = hit.state === "fresh" ? "HIT" : "STALE";
        const response = headResponse(200, policy, state, undefined, requestId);
        logRequest(requestId, {
          path: url.pathname,
          status: response.status,
          cache: state,
          durationMs: Date.now() - started,
        });
        return response;
      }
    }

    const result = await runLoader(route, routeCtx, "request");
    if (result.kind === "redirect") {
      const response = loaderRedirectResponse(result, routeCtx.url, requestId);
      logOutcome(requestId, url, response.status, "REDIRECT", started);
      return response;
    }
    if (result.kind === "notFound") {
      const response = headResponse(404, { kind: "none" }, "BYPASS", result.headers, requestId);
      logOutcome(requestId, url, response.status, "BYPASS", started);
      return response;
    }
    if (result.kind === "error") {
      const status = normalizeErrorStatus(result.status);
      logger.warn("route expected error", {
        errorId: randomUUID(),
        requestId,
        path: url.pathname,
        route: route.path,
        status,
        code: result.error.code,
      });
      const response = headResponse(status, { kind: "none" }, "BYPASS", result.headers, requestId);
      logOutcome(requestId, url, response.status, "BYPASS", started);
      return response;
    }

    const state = key ? "MISS" : "BYPASS";
    const response = headResponse(result.status ?? 200, policy, state, result.headers, requestId);
    logOutcome(requestId, url, response.status, state, started);
    return response;
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
