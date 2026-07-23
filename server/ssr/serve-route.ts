import { randomUUID } from "node:crypto";

import type { Assets } from "@server/assets";
import * as cache from "@server/cache";
import { coalesceColdMiss } from "@server/cache/cold-fill";
import { scheduleRevalidation } from "@server/cache/revalidation";
import { stitchCachedHtml } from "@server/cache/stitch-fragments";
import { logError, logger } from "@server/logger";
import { SpanKind, withSpan } from "@server/observability";
import { renderNotFoundDocument, renderRouteErrorDocument } from "@server/route-boundary";

import type { CachePolicy, Ctx, LoaderResult, Route } from "@originloom/react/lib/types";

import { rethrowRequestDeadline } from "./context";
import { CacheFillTimeoutError, executeRoute, executeRouteWithBudget } from "./execute-route";
import { htmlResponse, loaderRedirectResponse, logRequest, normalizeErrorStatus } from "./response";
import type { RouteExecution } from "./types";

type ServeRouteOptions = {
  request: Request;
  url: URL;
  route: Route;
  routeCtx: Ctx;
  policy: CachePolicy;
  cacheKey: string | null;
  assets: Assets;
  requestId: string | undefined;
  started: number;
};

export async function serveRoute(options: ServeRouteOptions): Promise<Response> {
  if (options.cacheKey && options.request.method === "GET") {
    const hit = await cache.read(options.cacheKey);
    if (hit) return cachedResponse(options, hit.body, hit.state === "fresh" ? "HIT" : "STALE");
  }

  try {
    let execution: RouteExecution;
    if (options.cacheKey && options.request.method === "GET") {
      const coldMiss = await coalesceColdMiss({
        key: options.cacheKey,
        policy: options.policy,
        work: async () =>
          toColdFillResult(
            await executeRouteWithBudget(options.route, options.routeCtx, options.assets),
          ),
        isTimeout: (error) => error instanceof CacheFillTimeoutError,
      });
      if (coldMiss.kind === "cache") {
        return cachedResponse(options, coldMiss.body, coldMiss.state);
      }
      execution = coldMiss.work.value;
    } else {
      execution = await executeRoute(options.route, options.routeCtx, options.assets, "request");
    }
    return respondToExecution(options, execution);
  } catch (error) {
    return renderUnexpectedRouteError(options, error);
  }
}

async function cachedResponse(
  options: ServeRouteOptions,
  cachedBody: string,
  state: "HIT" | "STALE",
): Promise<Response> {
  if (state === "STALE") scheduleRouteRevalidation(options);
  logOutcome(options, 200, state);
  const body = await stitchCachedHtml(cachedBody, options.route, options.routeCtx, true);
  return htmlResponse(body, 200, options.policy, state, undefined, options.requestId);
}

function toColdFillResult(value: RouteExecution) {
  const status = "status" in value.result ? (value.result.status ?? 200) : 200;
  const terminal =
    (value.result.kind !== undefined && value.result.kind !== "data") || status !== 200;
  return {
    value,
    ...(value.body !== undefined ? { body: value.body } : {}),
    cacheable: !terminal,
    terminal,
  };
}

async function respondToExecution(
  options: ServeRouteOptions,
  execution: RouteExecution,
): Promise<Response> {
  const { result } = execution;
  if (result.kind === "redirect") return respondToRedirect(options, result);
  if (result.kind === "notFound") return respondToNotFound(options, result);
  if (result.kind === "error") return respondToExpectedError(options, result);

  if (execution.body === undefined && execution.streamResult === undefined) {
    throw new Error("Route data result was not rendered");
  }
  const state = options.cacheKey ? "MISS" : "BYPASS";
  const status = result.status ?? 200;
  logOutcome(options, status, state);
  if (execution.streamResult) {
    return htmlResponse(
      execution.streamResult.stream,
      status,
      options.policy,
      state,
      result.headers,
      options.requestId,
    );
  }

  const body = await stitchCachedHtml(execution.body ?? "", options.route, options.routeCtx, false);
  return htmlResponse(body, status, options.policy, state, result.headers, options.requestId);
}

function respondToRedirect(
  options: ServeRouteOptions,
  result: Extract<LoaderResult<unknown>, { kind: "redirect" }>,
): Response {
  const response = loaderRedirectResponse(result, options.routeCtx.url, options.requestId);
  logOutcome(options, result.status ?? 307, "REDIRECT");
  return response;
}

async function respondToNotFound(
  options: ServeRouteOptions,
  result: Extract<LoaderResult<unknown>, { kind: "notFound" }>,
): Promise<Response> {
  const body = await withSpan(
    "ssr.render.not_found",
    { kind: SpanKind.INTERNAL, attributes: { "http.route": options.route.path } },
    () => renderNotFoundDocument(options.assets, options.routeCtx, options.route),
  );
  logOutcome(options, 404, "BYPASS");
  return htmlResponse(body, 404, { kind: "none" }, "BYPASS", result.headers, options.requestId);
}

async function respondToExpectedError(
  options: ServeRouteOptions,
  result: Extract<LoaderResult<unknown>, { kind: "error" }>,
): Promise<Response> {
  const status = normalizeErrorStatus(result.status);
  logger.warn("route expected error", {
    errorId: randomUUID(),
    requestId: options.requestId,
    path: options.url.pathname,
    route: options.route.path,
    status,
    code: result.error.code,
  });
  const body = await withSpan(
    "ssr.render.route_error",
    { kind: SpanKind.INTERNAL, attributes: { "http.route": options.route.path } },
    () =>
      renderRouteErrorDocument(
        options.assets,
        options.routeCtx,
        options.route,
        result.error,
        status,
      ),
  );
  logOutcome(options, status, "BYPASS");
  return htmlResponse(body, status, { kind: "none" }, "BYPASS", result.headers, options.requestId);
}

async function renderUnexpectedRouteError(
  options: ServeRouteOptions,
  error: unknown,
): Promise<Response> {
  rethrowRequestDeadline(options.request, error);
  const errorId = randomUUID();
  logError(error, {
    msg: "route execution failed",
    errorId,
    requestId: options.requestId,
    path: options.url.pathname,
    route: options.route.path,
  });
  const body = await withSpan(
    "ssr.render.route_error",
    { kind: SpanKind.INTERNAL, attributes: { "http.route": options.route.path } },
    () => renderRouteErrorDocument(options.assets, options.routeCtx, options.route, null, 500),
  );
  logOutcome(options, 500, "ERROR");
  return htmlResponse(body, 500, { kind: "none" }, "ERROR", undefined, options.requestId);
}

function scheduleRouteRevalidation(options: ServeRouteOptions): void {
  scheduleRevalidation(
    options.cacheKey!,
    options.route,
    options.routeCtx,
    options.policy,
    options.assets,
    options.requestId,
  );
}

function logOutcome(options: ServeRouteOptions, status: number, cacheState: string): void {
  logRequest(options.requestId, {
    path: options.url.pathname,
    status,
    cache: cacheState,
    durationMs: Date.now() - options.started,
  });
}
