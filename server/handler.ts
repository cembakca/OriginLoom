import { randomUUID } from "node:crypto";

import { isBotRequest } from "~/components/analytics/gtm-bootstrap";
import { match } from "~/lib/match";
import type { Ctx, LoaderResult, Route } from "~/lib/types";
import { normalizePublicUrl, resolveRoute } from "~/routing";

import type { Assets } from "./assets";
import * as cache from "./cache";
import { coalesceColdMiss } from "./cache/cold-fill";
import {
  fragmentRequiresShell,
  getOrSetFragmentByName,
  shouldResolveFragment,
} from "./cache/fragment";
import { config } from "./config";
import {
  renderDocument,
  renderDocumentToStream,
  type StreamResult,
  streamToString,
} from "./document";
import { errorResponse } from "./error";
import { logError, logger } from "./logger";
import { observeRevalidation } from "./metrics";
import { isRequestDeadlineError } from "./middleware/request-deadline";
import { setActiveHttpRoute, SpanKind, SpanStatusCode, withSpan } from "./observability";
import { proxyRequest } from "./proxy";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "./public-url";
import { renderNotFoundDocument, renderRouteErrorDocument } from "./route-boundary";
import { buildShellData } from "./services/shell-data";

export type HandleContext = {
  requestId?: string;
  trackingId?: string;
  clientIp?: string;
  cspNonce?: string;
};

const revalidationsInFlight = new Map<string, Promise<void>>();

type RouteExecution = {
  result: LoaderResult<unknown>;
  body?: string;
  streamResult?: StreamResult;
};

class CacheFillTimeoutError extends Error {
  constructor() {
    super(`Cold cache fill exceeded ${config.cacheFillTimeoutMs}ms`);
    this.name = "CacheFillTimeoutError";
  }
}

export async function drainRevalidations(timeoutMs: number): Promise<boolean> {
  const pending = [...revalidationsInFlight.values()];
  if (pending.length === 0) return true;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = Promise.allSettled(pending).then(() => true);
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
    timeout.unref?.();
  });
  const drained = await Promise.race([completed, deadline]);
  if (timeout) clearTimeout(timeout);
  return drained;
}

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

/** Resolve the same route outcome as GET without rendering React or filling the HTML cache. */
export async function handleHead(
  request: Request,
  routeTable: Route[],
  ctx: HandleContext = {},
): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const requestId = ctx.requestId;

  try {
    const normalized = normalizePublicUrl(url);
    if (normalized.kind === "invalid") return publicUrlErrorResponse(requestId);
    if (normalized.kind === "redirect")
      return publicUrlRedirectResponse(normalized.location, requestId);

    const resolution = resolveRoute(url, config.gatewayUrl);
    if (resolution.kind === "redirect") return Response.redirect(resolution.url, resolution.status);
    if (resolution.kind === "proxy") {
      const response = await proxyRequest(request, resolution.url, ctx.clientIp);
      if (requestId) response.headers.set("x-request-id", requestId);
      return response;
    }

    const internalUrl = new URL(url);
    internalUrl.pathname = resolution.pathname;
    if (resolution.kind === "rewrite") internalUrl.search = resolution.search;
    const matched = match(routeTable, resolution.pathname);
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
    const policy = route.cache?.(routeCtx) ?? { kind: "none" as const };
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
      const response = loaderRedirectResponse(result, routeCtx, requestId);
      logRequest(requestId, {
        path: url.pathname,
        status: response.status,
        cache: "REDIRECT",
        durationMs: Date.now() - started,
      });
      return response;
    }

    if (result.kind === "notFound") {
      const response = headResponse(404, { kind: "none" }, "BYPASS", result.headers, requestId);
      logRequest(requestId, {
        path: url.pathname,
        status: response.status,
        cache: "BYPASS",
        durationMs: Date.now() - started,
      });
      return response;
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
      const response = headResponse(status, { kind: "none" }, "BYPASS", result.headers, requestId);
      logRequest(requestId, {
        path: url.pathname,
        status: response.status,
        cache: "BYPASS",
        durationMs: Date.now() - started,
      });
      return response;
    }

    const state = key ? "MISS" : "BYPASS";
    const response = headResponse(result.status ?? 200, policy, state, result.headers, requestId);
    logRequest(requestId, {
      path: url.pathname,
      status: response.status,
      cache: state,
      durationMs: Date.now() - started,
    });
    return response;
  } catch (error) {
    rethrowRequestDeadline(request, error);
    logError(error, { msg: "HEAD route resolution failed", requestId, path: url.pathname });
    return headResponse(500, { kind: "none" }, "ERROR", undefined, requestId);
  }
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
      return html(body, 404, { kind: "none" }, "BYPASS", undefined, requestId);
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
      return html(body, 404, { kind: "none" }, "BYPASS", undefined, requestId);
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
        return html(stitchedBody, 200, policy, state, undefined, requestId);
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
          return html(stitchedBody, 200, policy, coldMiss.state, undefined, requestId);
        }
        execution = coldMiss.work.value;
      } else {
        execution = await executeRoute(route, routeCtx, assets, "request");
      }
      const { result } = execution;

      if (result.kind === "redirect") {
        const status = result.status ?? 307;
        const response = loaderRedirectResponse(result, routeCtx, requestId);
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
        return html(body, 404, { kind: "none" }, "BYPASS", result.headers, requestId);
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
        return html(body, status, { kind: "none" }, "BYPASS", result.headers, requestId);
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
        return html(
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
        return html(
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
      return html(body, 500, { kind: "none" }, "ERROR", undefined, requestId);
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

async function executeRouteWithBudget(
  route: Route,
  routeCtx: Ctx,
  assets: Assets,
): Promise<RouteExecution> {
  const controller = new AbortController();
  const timeoutError = new CacheFillTimeoutError();
  const timer = setTimeout(() => controller.abort(timeoutError), config.cacheFillTimeoutMs);
  timer.unref?.();
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(timeoutError), { once: true });
  });
  const budgetCtx: Ctx = {
    ...routeCtx,
    request: new Request(routeCtx.request, {
      signal: AbortSignal.any([routeCtx.request.signal, controller.signal]),
    }),
  };

  try {
    return await Promise.race([executeRoute(route, budgetCtx, assets, "cache_fill"), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function rethrowRequestDeadline(request: Request, error: unknown): void {
  if (isRequestDeadlineError(error)) throw error;
  if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
}

async function executeRoute(
  route: Route,
  routeCtx: Ctx,
  assets: Assets,
  phase: "request" | "revalidation" | "cache_fill",
): Promise<RouteExecution> {
  const result = await runLoader(route, routeCtx, phase);
  if (result.kind && result.kind !== "data") return { result };

  const isBot = isBotRequest(routeCtx.request);
  const shouldStream = route.streaming && phase === "request" && !isBot;

  if (shouldStream) {
    let streamResult: StreamResult;
    try {
      streamResult = await renderDocumentToStream(
        route,
        result.data,
        assets,
        { routeCtx },
        (error) => {
          logError(error, {
            requestId: routeCtx.trackingId,
            msg: "deferred stream render error",
            path: routeCtx.url.pathname,
          });
        },
      );
    } catch (error) {
      rethrowRequestDeadline(routeCtx.request, error);
      logError(error, {
        msg: "stream shell render failed",
        path: routeCtx.url.pathname,
      });
      const errorBody = await renderRouteErrorDocument(assets, routeCtx, route, null, 500);
      return {
        result: {
          kind: "error",
          error: { code: "stream_shell_error", message: "Stream shell render error" },
        },
        body: errorBody,
      };
    }

    routeCtx.request.signal.addEventListener("abort", () => {
      streamResult.abort();
    });

    return { result, streamResult };
  } else {
    const body = await runRender(route, result.data, assets, routeCtx, phase);
    return { result, body };
  }
}

function createRouteContext(
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
    ...(ctx.trackingId !== undefined ? { trackingId: ctx.trackingId } : {}),
    ...(ctx.cspNonce !== undefined ? { cspNonce: ctx.cspNonce } : {}),
  };
}

function loaderRedirectResponse(
  result: Extract<LoaderResult<unknown>, { kind: "redirect" }>,
  routeCtx: Ctx,
  requestId?: string,
): Response {
  const headers = new Headers(result.headers);
  headers.set("location", new URL(result.location, routeCtx.url).toString());
  headers.set("cache-control", "private, no-store");
  headers.set("x-cache", "BYPASS");
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status: result.status ?? 307, headers });
}

function normalizeErrorStatus(status = 500): number {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError(`Route error status must be between 400 and 599: ${status}`);
  }
  return status;
}

function scheduleRevalidation(
  key: string,
  route: Route,
  routeCtx: Parameters<Route["loader"]>[0],
  policy: ReturnType<NonNullable<Route["cache"]>>,
  assets: Assets,
  requestId?: string,
): void {
  if (revalidationsInFlight.has(key)) return;

  const pending = runRevalidation(key, route, routeCtx, policy, assets, requestId).finally(() => {
    if (revalidationsInFlight.get(key) === pending) revalidationsInFlight.delete(key);
  });
  revalidationsInFlight.set(key, pending);
}

async function runRevalidation(
  key: string,
  route: Route,
  routeCtx: Parameters<Route["loader"]>[0],
  policy: ReturnType<NonNullable<Route["cache"]>>,
  assets: Assets,
  requestId?: string,
): Promise<void> {
  const started = performance.now();
  let outcome: "success" | "error" | "lock_miss" = "error";
  try {
    outcome = await withSpan(
      "cache.revalidate",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "http.route": route.path, "cache.operation": "revalidate" },
      },
      (span) =>
        revalidate(key, route, routeCtx, policy, assets, requestId).then((result) => {
          span.setAttribute("cache.revalidation.outcome", result);
          if (result === "error") span.setStatus({ code: SpanStatusCode.ERROR });
          return result;
        }),
    );
  } finally {
    observeRevalidation(outcome, performance.now() - started);
  }
}

async function revalidate(
  key: string,
  route: Route,
  routeCtx: Parameters<Route["loader"]>[0],
  policy: ReturnType<NonNullable<Route["cache"]>>,
  assets: Assets,
  requestId?: string,
): Promise<"success" | "error" | "lock_miss"> {
  const lockToken = await cache.acquireRevalidationLock(key);
  if (!lockToken) return "lock_miss";
  try {
    for (let attempt = 1; attempt <= config.revalidationAttempts; attempt++) {
      try {
        const result = await runLoader(route, routeCtx, "revalidation");
        if (result.kind && result.kind !== "data") {
          throw new Error(`revalidation loader returned terminal result: ${result.kind}`);
        }
        if ((result.status ?? 200) !== 200) {
          throw new Error(`revalidation loader returned ${result.status ?? 200}`);
        }
        const body = await runRender(route, result.data, assets, routeCtx, "revalidation");
        if (!(await cache.write(key, body, policy)))
          throw new Error("revalidation cache write failed");
        return "success";
      } catch (error) {
        logError(error, {
          requestId,
          key,
          attempt,
          maxAttempts: config.revalidationAttempts,
          msg: "revalidate attempt failed",
        });
        if (attempt < config.revalidationAttempts) {
          await delay(config.revalidationBackoffMs * 2 ** (attempt - 1));
        }
      }
    }
    return "error";
  } finally {
    await cache.releaseRevalidationLock(key, lockToken);
  }
}

function runLoader(
  route: Route,
  routeCtx: Parameters<Route["loader"]>[0],
  phase: "request" | "revalidation" | "cache_fill",
) {
  return withSpan(
    "route.loader",
    {
      kind: SpanKind.INTERNAL,
      attributes: { "http.route": route.path, "ssr.phase": phase },
    },
    () => route.loader(routeCtx),
  );
}

async function runRender<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  routeCtx: Parameters<Route<T>["loader"]>[0],
  phase: "request" | "revalidation" | "cache_fill",
): Promise<string> {
  return withSpan(
    "ssr.render",
    {
      kind: SpanKind.INTERNAL,
      attributes: { "http.route": route.path, "ssr.phase": phase },
    },
    async () => {
      if (route.streaming) {
        const streamResult = await renderDocumentToStream(
          route,
          data,
          assets,
          { routeCtx },
          (error) => {
            logError(error, {
              requestId: routeCtx.trackingId,
              msg: "runRender stream error",
              path: routeCtx.url.pathname,
            });
          },
        );
        await streamResult.allReady;
        return streamToString(streamResult.stream);
      } else {
        return renderDocument(route, data, assets, { routeCtx });
      }
    },
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function html(
  body: string | ReadableStream,
  status: number,
  policy: ReturnType<NonNullable<Route["cache"]>>,
  state: string,
  extra?: Record<string, string>,
  requestId?: string,
) {
  const isStream = body instanceof ReadableStream;
  const headers: Record<string, string> = {
    ...extra,
    "content-type": "text/html; charset=utf-8",
    "cache-control": isStream
      ? "no-transform, no-cache, no-store, must-revalidate"
      : cache.cacheControl(policy),
    "x-cache": state,
  };
  if (requestId) headers["x-request-id"] = requestId;
  if (isStream) {
    headers["transfer-encoding"] = "chunked";
  }

  return new Response(body, { status, headers });
}

function headResponse(
  status: number,
  policy: ReturnType<NonNullable<Route["cache"]>>,
  state: string,
  extra?: Record<string, string>,
  requestId?: string,
): Response {
  const headers = new Headers({
    ...extra,
    "content-type": "text/html; charset=utf-8",
    "cache-control": cache.cacheControl(policy),
    "x-cache": state,
  });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status, headers });
}

function logRequest(
  requestId: string | undefined,
  fields: {
    path: string;
    status: number;
    cache: string;
    durationMs: number;
  },
) {
  logger.info("request", {
    ...fields,
    ...(requestId !== undefined ? { requestId } : {}),
  });
}

async function stitchCachedHtml(
  htmlContent: string,
  route: Route,
  routeCtx: Ctx,
  cachedDocument: boolean,
): Promise<string> {
  if (route.minimalChrome) {
    return htmlContent;
  }

  const fragmentRegex =
    /<ssr-fragment name="([a-zA-Z0-9_-]+)" style="display:\s*contents">[\s\S]*?<\/ssr-fragment>/g;
  const matches = [...htmlContent.matchAll(fragmentRegex)].filter((match) =>
    shouldResolveFragment(match[1]!, cachedDocument),
  );

  if (matches.length === 0) {
    return htmlContent;
  }

  try {
    const needsShell = matches.some((match) => fragmentRequiresShell(match[1]!));
    const shell = needsShell ? await buildShellData(routeCtx) : null;
    if (needsShell && !shell?.menu) {
      return htmlContent;
    }

    const names = [...new Set(matches.map((match) => match[1]!))];
    const resolvedHtmls = await Promise.all(
      names.map(async (name): Promise<[string, string | undefined]> => {
        try {
          return [name, await getOrSetFragmentByName(name, shell, routeCtx)];
        } catch (error) {
          rethrowRequestDeadline(routeCtx.request, error);
          logError(error, {
            msg: "Failed to resolve cached HTML fragment",
            fragment: name,
            path: routeCtx.url.pathname,
          });
          return [name, undefined];
        }
      }),
    );
    const htmlMap = new Map(resolvedHtmls);

    let stitched = htmlContent;
    stitched = stitched.replace(fragmentRegex, (fullMatch: string, name: string) => {
      const freshHtml = htmlMap.get(name);
      if (freshHtml !== undefined) {
        return `<ssr-fragment name="${name}" style="display: contents">${freshHtml}</ssr-fragment>`;
      }
      return fullMatch;
    });

    return stitched;
  } catch (error) {
    rethrowRequestDeadline(routeCtx.request, error);
    logError(error, {
      msg: "Failed to stitch cached HTML fragments",
      path: routeCtx.url.pathname,
    });
    return htmlContent;
  }
}
