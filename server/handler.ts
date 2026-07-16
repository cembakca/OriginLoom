import { randomUUID } from "node:crypto";

import { match } from "~/lib/match";
import type { Ctx, LoaderResult, Route } from "~/lib/types";
import { resolveRoute } from "~/routing";

import * as cache from "./cache";
import { config } from "./config";
import { type Assets, renderDocument } from "./document";
import { errorResponse } from "./error";
import { logError, logger } from "./logger";
import { proxyRequest } from "./proxy";
import { renderNotFoundDocument, renderRouteErrorDocument } from "./route-boundary";

export type HandleContext = {
  requestId?: string;
  trackingId?: string;
  clientIp?: string;
};

const revalidationsInFlight = new Map<string, Promise<void>>();

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

/**
 * The whole request pipeline. Read it top to bottom — there is nothing else.
 *
 *   1. resolve redirects / rewrites / proxy  (src/routing/rules.ts)
 *   2. match internal path → route
 *   3. cache → loader → render
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
      const routeCtx = createRouteContext(request, internalUrl, resolution.publicPath, {}, ctx);
      const body = await renderNotFoundDocument(assets, routeCtx);
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
        return html(hit.body, 200, policy, state, undefined, requestId);
      }
    }

    try {
      const result = await route.loader(routeCtx);

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
        const body = await renderNotFoundDocument(assets, routeCtx, route);
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
        const body = await renderRouteErrorDocument(assets, routeCtx, route, result.error, status);
        logRequest(requestId, {
          path: url.pathname,
          status,
          cache: "BYPASS",
          durationMs: Date.now() - started,
        });
        return html(body, status, { kind: "none" }, "BYPASS", result.headers, requestId);
      }

      const body = await renderDocument(route, result.data, assets, { routeCtx });
      if (key && request.method === "GET" && (result.status ?? 200) === 200) {
        await cache.write(key, body, policy);
      }

      const cacheState = key ? "MISS" : "BYPASS";
      logRequest(requestId, {
        path: url.pathname,
        status: result.status ?? 200,
        cache: cacheState,
        durationMs: Date.now() - started,
      });

      return html(body, result.status ?? 200, policy, cacheState, result.headers, requestId);
    } catch (routeError) {
      const errorId = randomUUID();
      logError(routeError, {
        msg: "route execution failed",
        errorId,
        requestId,
        path: url.pathname,
        route: route.path,
      });
      const body = await renderRouteErrorDocument(assets, routeCtx, route, null, 500);
      logRequest(requestId, {
        path: url.pathname,
        status: 500,
        cache: "ERROR",
        durationMs: Date.now() - started,
      });
      return html(body, 500, { kind: "none" }, "ERROR", undefined, requestId);
    }
  } catch (err) {
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

  const pending = revalidate(key, route, routeCtx, policy, assets, requestId).finally(() => {
    if (revalidationsInFlight.get(key) === pending) revalidationsInFlight.delete(key);
  });
  revalidationsInFlight.set(key, pending);
}

async function revalidate(
  key: string,
  route: Route,
  routeCtx: Parameters<Route["loader"]>[0],
  policy: ReturnType<NonNullable<Route["cache"]>>,
  assets: Assets,
  requestId?: string,
) {
  const lockToken = await cache.acquireRevalidationLock(key);
  if (!lockToken) return;
  try {
    for (let attempt = 1; attempt <= config.revalidationAttempts; attempt++) {
      try {
        const result = await route.loader(routeCtx);
        if (result.kind && result.kind !== "data") {
          throw new Error(`revalidation loader returned terminal result: ${result.kind}`);
        }
        if ((result.status ?? 200) !== 200) {
          throw new Error(`revalidation loader returned ${result.status ?? 200}`);
        }
        const body = await renderDocument(route, result.data, assets, { routeCtx });
        if (!(await cache.write(key, body, policy)))
          throw new Error("revalidation cache write failed");
        return;
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
  } finally {
    await cache.releaseRevalidationLock(key, lockToken);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function html(
  body: string,
  status: number,
  policy: ReturnType<NonNullable<Route["cache"]>>,
  state: string,
  extra?: Record<string, string>,
  requestId?: string,
) {
  const headers: Record<string, string> = {
    ...extra,
    "content-type": "text/html; charset=utf-8",
    "cache-control": cache.cacheControl(policy),
    "x-cache": state,
  };
  if (requestId) headers["x-request-id"] = requestId;

  return new Response(body, { status, headers });
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
