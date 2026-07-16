import { match } from "~/lib/match";
import type { Ctx, Route } from "~/lib/types";
import { resolveRoute } from "~/routing";

import * as cache from "./cache";
import { config } from "./config";
import { type Assets, renderDocument } from "./document";
import { errorResponse } from "./error";
import { logError, logger } from "./logger";
import { proxyRequest } from "./proxy";

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
      logRequest(requestId, {
        path: url.pathname,
        status: 404,
        cache: "NONE",
        durationMs: Date.now() - started,
      });
      return new Response("Not found", { status: 404 });
    }

    const routeCtx: Ctx = {
      request,
      params: m.params,
      url: internalUrl,
      publicPath: resolution.publicPath,
      siteUrl: config.siteUrl,
      ...(ctx.trackingId !== undefined ? { trackingId: ctx.trackingId } : {}),
    };
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

    const result = await route.loader(routeCtx);
    const docCtx = { routeCtx };
    const body = await renderDocument(route, result.data, assets, docCtx);
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
  } catch (err) {
    logError(err, { requestId, path: url.pathname });
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
    "content-type": "text/html; charset=utf-8",
    "cache-control": cache.cacheControl(policy),
    "x-cache": state,
    ...extra,
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
