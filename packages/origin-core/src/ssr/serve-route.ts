import { randomUUID } from "node:crypto";

import type { SsrFragmentMarker } from "@originloom/shared/fragment-markup";
import type { CachePolicy, Ctx, LoaderResult, Route } from "@originloom/shared/lib/types";

import type { Assets } from "../assets.js";
import { coalesceColdMiss } from "../cache/cold-fill.js";
import {
  cachedHtmlDynamicValues,
  materializeCachedHtmlDynamicValues,
  normalizeCachedHtmlDynamicValues,
} from "../cache/dynamic-html.js";
import * as cache from "../cache/index.js";
import { scheduleRevalidation } from "../cache/revalidation.js";
import { stitchCachedHtml } from "../cache/stitch-fragments.js";
import { logger } from "../logger.js";
import { SpanKind, withSpan } from "../observability.js";
import { reportRequestError } from "../request-error.js";
import { renderNotFoundDocument, renderRouteErrorDocument } from "../route-boundary.js";
import { rethrowRequestDeadline } from "./context.js";
import { CacheFillTimeoutError, executeRoute, executeRouteWithBudget } from "./execute-route.js";
import {
  htmlResponse,
  loaderRedirectResponse,
  logRouteOutcome,
  normalizeErrorStatus,
  type ServerTimings,
} from "./response.js";
import type { RouteExecution } from "./types.js";

export type ServeRouteOptions = {
  request: Request;
  url: URL;
  route: Route;
  routeCtx: Ctx;
  policy: CachePolicy;
  cacheKey: string | null;
  assets: Assets;
  requestId: string | undefined;
  started: number;
  /** Skip the cache probe when the caller already tried the fast path. */
  skipCacheProbe?: boolean;
};

/** Serves a cached GET body without acquiring render admission. */
export async function tryServeCachedRoute(options: ServeRouteOptions): Promise<Response | null> {
  if (!options.cacheKey || options.request.method !== "GET") return null;
  const hit = await cache.read(options.cacheKey);
  if (!hit) return null;
  return cachedResponse(
    options,
    hit.body,
    hit.state === "fresh" ? "HIT" : "STALE",
    hit.hasFragments,
    hit.fragmentMarkers,
  );
}

export async function serveRoute(options: ServeRouteOptions): Promise<Response> {
  if (!options.skipCacheProbe) {
    const cached = await tryServeCachedRoute(options);
    if (cached) return cached;
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
            options.routeCtx,
          ),
        isTimeout: (error) => error instanceof CacheFillTimeoutError,
      });
      if (coldMiss.kind === "cache") {
        return cachedResponse(
          options,
          coldMiss.body,
          coldMiss.state,
          coldMiss.hasFragments,
          coldMiss.fragmentMarkers,
        );
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
  hasFragments: boolean,
  fragmentMarkers: readonly SsrFragmentMarker[],
): Promise<Response> {
  if (state === "STALE") scheduleRouteRevalidation(options);
  logOutcome(options, 200, state);
  const stitchedBody = hasFragments
    ? await stitchCachedHtml(cachedBody, options.route, options.routeCtx, true, fragmentMarkers)
    : cachedBody;
  const body = materializeCachedHtmlDynamicValues(stitchedBody, options.routeCtx);
  return htmlResponse(body, 200, {
    policy: options.policy,
    state,
    requestId: options.requestId,
    timings: serverTimings(options),
  });
}

function toColdFillResult(value: RouteExecution, dynamicValues: Ctx) {
  const status = "status" in value.result ? (value.result.status ?? 200) : 200;
  const terminal =
    (value.result.kind !== undefined && value.result.kind !== "data") || status !== 200;
  const body =
    value.body === undefined
      ? undefined
      : normalizeCachedHtmlDynamicValues(value.body, dynamicValues);
  const normalizedValue = body === undefined || body === value.body ? value : { ...value, body };
  return {
    value: normalizedValue,
    ...(body !== undefined ? { body } : {}),
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
  if (result.kind === "error") return respondToExpectedError(options, result, execution.errorId);

  if (execution.body === undefined && execution.streamResult === undefined) {
    throw new Error("Route data result was not rendered");
  }
  const state = options.cacheKey ? "MISS" : "BYPASS";
  // A rejected submission renders the page again, so the loader has no reason to
  // set a status — the action is what knows the request was refused. The loader
  // still wins if it says something, because a 404 outranks a 422.
  const status = result.status ?? execution.submission?.status ?? 200;
  const headers = execution.submission?.headers
    ? { ...execution.submission.headers, ...result.headers }
    : result.headers;
  logOutcome(options, status, state);
  if (execution.streamResult) {
    return htmlResponse(execution.streamResult.stream, status, {
      policy: options.policy,
      state,
      headers,
      requestId: options.requestId,
      timings: serverTimings(options, execution),
    });
  }

  const stitchedBody = await stitchCachedHtml(
    execution.body ?? "",
    options.route,
    options.routeCtx,
    false,
    undefined,
    execution.shellResolution,
  );
  const body = materializeCachedHtmlDynamicValues(stitchedBody, options.routeCtx);
  return htmlResponse(body, status, {
    policy: options.policy,
    state,
    headers,
    requestId: options.requestId,
    timings: serverTimings(options, execution),
  });
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
  const rendered = await withSpan(
    "ssr.render.not_found",
    { kind: SpanKind.INTERNAL, attributes: { "http.route": options.route.path } },
    () =>
      renderNotFoundDocument(
        options.assets,
        cacheSafeRenderContext(options.routeCtx),
        options.route,
      ),
  );
  logOutcome(options, 404, "BYPASS");
  const body = materializeCachedHtmlDynamicValues(rendered, options.routeCtx);
  return htmlResponse(body, 404, {
    policy: { kind: "none" },
    state: "BYPASS",
    headers: result.headers,
    requestId: options.requestId,
    timings: serverTimings(options),
  });
}

async function respondToExpectedError(
  options: ServeRouteOptions,
  result: Extract<LoaderResult<unknown>, { kind: "error" }>,
  existingErrorId?: string,
): Promise<Response> {
  const status = normalizeErrorStatus(result.status);
  const errorId = existingErrorId ?? randomUUID();
  logger.warn("route expected error", {
    errorId,
    requestId: options.requestId,
    path: options.url.pathname,
    route: options.route.path,
    status,
    code: result.error.code,
  });
  const rendered = await withSpan(
    "ssr.render.route_error",
    { kind: SpanKind.INTERNAL, attributes: { "http.route": options.route.path } },
    () =>
      renderRouteErrorDocument(
        options.assets,
        cacheSafeRenderContext(options.routeCtx),
        options.route,
        result.error,
        status,
        errorId,
      ),
  );
  const body = materializeCachedHtmlDynamicValues(rendered, options.routeCtx);
  logOutcome(options, status, "BYPASS");
  return htmlResponse(body, status, {
    policy: { kind: "none" },
    state: "BYPASS",
    headers: result.headers,
    requestId: options.requestId,
    timings: serverTimings(options),
  });
}

async function renderUnexpectedRouteError(
  options: ServeRouteOptions,
  error: unknown,
): Promise<Response> {
  rethrowRequestDeadline(options.request, error);
  const errorId = randomUUID();
  reportRequestError({
    error,
    msg: "route execution failed",
    phase: "route",
    errorId,
    requestId: options.requestId,
    path: options.url.pathname,
    method: options.request.method,
    route: options.route.path,
  });
  const rendered = await withSpan(
    "ssr.render.route_error",
    { kind: SpanKind.INTERNAL, attributes: { "http.route": options.route.path } },
    () =>
      renderRouteErrorDocument(
        options.assets,
        cacheSafeRenderContext(options.routeCtx),
        options.route,
        null,
        500,
        errorId,
      ),
  );
  const body = materializeCachedHtmlDynamicValues(rendered, options.routeCtx);
  logOutcome(options, 500, "ERROR");
  return htmlResponse(body, 500, {
    policy: { kind: "none" },
    state: "ERROR",
    requestId: options.requestId,
    timings: serverTimings(options),
  });
}

function cacheSafeRenderContext(routeCtx: Ctx): Ctx {
  return { ...routeCtx, ...cachedHtmlDynamicValues(routeCtx) };
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
  logRouteOutcome(options.requestId, options.url, status, cacheState, options.started);
}

/**
 * The phases behind this response. `totalMs` is always available — it is wall
 * clock since the request arrived — while the loader/render split exists only
 * where a route actually executed, which a cache HIT by definition did not.
 */
function serverTimings(options: ServeRouteOptions, execution?: RouteExecution): ServerTimings {
  return {
    totalMs: Math.max(0, Date.now() - options.started),
    ...execution?.timings,
  };
}
