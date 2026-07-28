import { match } from "@originloom/shared/lib/match";
import type { Route } from "@originloom/shared/lib/types";
import { resolveRoute } from "@originloom/shared/routing";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";

import { config } from "../config.js";
import { observeRequestTimeout } from "../metrics.js";
import type { AppVariables, RequestClass } from "./context.js";

export type { RequestClass } from "./context.js";
type DeadlineOptions = Partial<Record<RequestClass, number>>;

export class RequestDeadlineError extends Error {
  constructor(
    readonly requestClass: RequestClass,
    readonly timeoutMs: number,
  ) {
    super(`${requestClass} request exceeded ${timeoutMs}ms`);
    this.name = "RequestDeadlineError";
  }
}

export type RequestDeadlineOptions = DeadlineOptions & {
  /**
   * Endpoints that hold their connection open on purpose — SSE, long polling.
   * They own their own lifetime, heartbeat and admission, so no deadline is
   * armed for them. Which endpoints those are is the app's knowledge.
   */
  longLivedRoutes?: readonly string[];
  /**
   * The concrete /api paths worth labelling in metrics. Anything outside it is
   * folded into one bucket, so an unmatched path cannot create a time series.
   */
  apiRouteLabels?: ReadonlySet<string>;
};

export function requestDeadline(
  routeTable: Route[],
  options: RequestDeadlineOptions = {},
): MiddlewareHandler<{ Variables: AppVariables }> {
  const longLived = new Set(options.longLivedRoutes ?? []);
  const apiRouteLabels = options.apiRouteLabels ?? new Set<string>();
  return async (c, next) => {
    const raw = c.req.raw;
    const requestClass = classifyRequest(raw);
    const timeoutMs = options[requestClass] ?? timeoutFor(requestClass);
    const controller = new AbortController();
    const signal = raw.signal.aborted
      ? raw.signal
      : AbortSignal.any([raw.signal, controller.signal]);
    const request = new Request(raw, { signal });
    const route = routeLabel(request, requestClass, routeTable, apiRouteLabels);

    c.set("request", request);
    c.set("requestClass", requestClass);
    c.set("requestRoute", route);

    if (longLived.has(new URL(raw.url).pathname)) {
      await next();
      return;
    }

    const deadline = timeout(timeoutMs, () => {
      const error = new RequestDeadlineError(requestClass, timeoutMs);
      observeRequestTimeout(requestClass, route);

      // Let the timeout rejection win the race, then cancel downstream work.
      const abortTimer = setTimeout(() => controller.abort(error), 0);
      abortTimer.unref?.();

      return new HTTPException(504, {
        res: timeoutResponse(requestClass, c.get("requestId")),
      });
    });

    await deadline(c, next);
  };
}

export function contextRequest(c: {
  req: { raw: Request };
  get(key: "request"): Request | undefined;
}): Request {
  return c.get("request") ?? c.req.raw;
}

export function isRequestDeadlineError(error: unknown): error is RequestDeadlineError {
  return error instanceof RequestDeadlineError;
}

/**
 * What kind of work this request is, which decides its time budget and whether
 * it competes for render capacity.
 *
 * `/api/` is the convention every app already follows for endpoints that are
 * not pages, and it is the only signal the platform can read without being told
 * each app's route names — which it has no business knowing. A configured proxy
 * rule outranks it: that is an explicit statement about a specific path, while
 * the prefix is a convention.
 *
 * An endpoint misread as a page gets the render time budget instead of the API
 * one, answers an oversized payload with an HTML error page rather than JSON,
 * and reports itself as a page in the timeout metrics.
 */
export function classifyRequest(request: Request): RequestClass {
  const url = new URL(request.url);
  if (resolveRoute(url, config.gatewayUrl).kind === "proxy") return "proxy";
  return url.pathname === "/api" || url.pathname.startsWith("/api/") ? "api" : "ssr";
}

function timeoutFor(requestClass: RequestClass): number {
  if (requestClass === "api") return config.apiRequestTimeoutMs;
  if (requestClass === "proxy") return config.proxyRequestTimeoutMs;
  return config.ssrRequestTimeoutMs;
}

function routeLabel(
  request: Request,
  requestClass: RequestClass,
  routeTable: Route[],
  apiRouteLabels: ReadonlySet<string>,
): string {
  if (requestClass === "api") {
    const pathname = new URL(request.url).pathname;
    return apiRouteLabels.has(pathname) ? pathname : "/api/<unmatched>";
  }
  if (requestClass === "proxy") return "<proxy>";

  const resolution = resolveRoute(new URL(request.url), config.gatewayUrl);
  if (resolution.kind === "redirect") return "<unmatched>";
  if (resolution.kind === "proxy") return "<proxy>";
  return (
    match(routeTable, resolution.pathname)?.route.path ?? infrastructureRoute(resolution.pathname)
  );
}

function infrastructureRoute(pathname: string): string {
  if (pathname.startsWith("/assets/")) return "/assets/*";
  if (pathname === "/healthz" || pathname === "/readyz") return "<health>";
  if (pathname === "/metrics") return "<unmatched>";
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return pathname;
  return "<unmatched>";
}

function timeoutResponse(requestClass: RequestClass, requestId: string): Response {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-request-id": requestId,
  });

  if (requestClass === "api") {
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({
        error: "Request timed out",
        code: "REQUEST_TIMEOUT",
        requestId,
      }),
      { status: 504, headers },
    );
  }

  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(
    '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>İstek zaman aşımına uğradı</title></head><body><main><h1>İstek zaman aşımına uğradı</h1><p>Lütfen kısa süre sonra yeniden deneyin.</p></main></body></html>',
    { status: 504, headers },
  );
}
