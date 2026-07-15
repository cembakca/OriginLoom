import { match } from "../src/lib/match";
import type { Route } from "../src/lib/types";
import { renderDocument, type Assets } from "./document";
import { errorResponse } from "./error";
import { logError, logger } from "./logger";
import * as cache from "./cache";

export type HandleContext = {
  requestId?: string;
};

/**
 * The whole request pipeline. Read it top to bottom — there is nothing else.
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
    const m = match(routes, url.pathname);
    if (!m) {
      logRequest({ requestId, path: url.pathname, status: 404, cache: "NONE", durationMs: Date.now() - started });
      return new Response("Not found", { status: 404 });
    }

    const routeCtx = { request, params: m.params, url };
    const { route } = m;

    const policy = route.cache?.(routeCtx) ?? { kind: "none" as const };
    const key = cache.cacheKey(policy);

    if (key && request.method === "GET") {
      const hit = await cache.read(key);
      if (hit) {
        if (hit.state === "stale") {
          void revalidate(key, route, routeCtx, policy, assets, requestId);
        }
        const state = hit.state === "fresh" ? "HIT" : "STALE";
        logRequest({
          requestId,
          path: url.pathname,
          status: 200,
          cache: state,
          durationMs: Date.now() - started,
        });
        return html(hit.body, 200, policy, state, undefined, requestId);
      }
    }

    const result = await route.loader(routeCtx);
    const body = renderDocument(route, result.data, assets);
    if (key && (result.status ?? 200) === 200) {
      await cache.write(key, body, policy);
    }

    const cacheState = key ? "MISS" : "BYPASS";
    logRequest({
      requestId,
      path: url.pathname,
      status: result.status ?? 200,
      cache: cacheState,
      durationMs: Date.now() - started,
    });

    return html(body, result.status ?? 200, policy, cacheState, result.headers, requestId);
  } catch (err) {
    logError(err, { requestId, path: url.pathname });
    logRequest({
      requestId,
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

async function revalidate(
  key: string,
  route: Route,
  routeCtx: Parameters<Route["loader"]>[0],
  policy: ReturnType<NonNullable<Route["cache"]>>,
  assets: Assets,
  requestId?: string,
) {
  try {
    const result = await route.loader(routeCtx);
    await cache.write(key, renderDocument(route, result.data, assets), policy);
  } catch (err) {
    logError(err, { requestId, key, msg: "revalidate failed" });
  }
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

function logRequest(fields: {
  requestId?: string;
  path: string;
  status: number;
  cache: string;
  durationMs: number;
}) {
  logger.info("request", fields);
}
