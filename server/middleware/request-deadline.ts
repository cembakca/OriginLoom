import { config } from "@server/config";
import { observeRequestTimeout } from "@server/metrics";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";

import { match } from "~/lib/match";
import type { Route } from "~/lib/types";
import { resolveRoute } from "~/routing";

import type { AppVariables, RequestClass } from "./context";

export type { RequestClass } from "./context";
type DeadlineOptions = Partial<Record<RequestClass, number>>;

const KNOWN_API_ROUTES = new Set([
  "/api/blogs",
  "/api/internal/account/summary",
  "/api/internal/auth/session",
  "/api/internal/cache/keys",
  "/api/internal/cache/purge",
  "/api/internal/client-errors",
  "/api/internal/refresh",
  "/api/markets/stream",
]);
const LONG_LIVED_API_ROUTES = new Set(["/api/markets/stream"]);

export class RequestDeadlineError extends Error {
  constructor(
    readonly requestClass: RequestClass,
    readonly timeoutMs: number,
  ) {
    super(`${requestClass} request exceeded ${timeoutMs}ms`);
    this.name = "RequestDeadlineError";
  }
}

export function requestDeadline(
  routeTable: Route[],
  options: DeadlineOptions = {},
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const raw = c.req.raw;
    const requestClass = classifyRequest(raw);
    const timeoutMs = options[requestClass] ?? timeoutFor(requestClass);
    const controller = new AbortController();
    const signal = raw.signal.aborted
      ? raw.signal
      : AbortSignal.any([raw.signal, controller.signal]);
    const request = new Request(raw, { signal });
    const route = routeLabel(request, requestClass, routeTable);

    c.set("request", request);
    c.set("requestClass", requestClass);
    c.set("requestRoute", route);

    // The endpoint owns heartbeat, connection lifetime and admission limits; a short API
    // deadline would terminate a healthy SSE connection before its first rotation.
    if (LONG_LIVED_API_ROUTES.has(new URL(raw.url).pathname)) {
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

function classifyRequest(request: Request): RequestClass {
  const url = new URL(request.url);
  if (KNOWN_API_ROUTES.has(url.pathname)) return "api";
  return resolveRoute(url, config.gatewayUrl).kind === "proxy" ? "proxy" : "ssr";
}

function timeoutFor(requestClass: RequestClass): number {
  if (requestClass === "api") return config.apiRequestTimeoutMs;
  if (requestClass === "proxy") return config.proxyRequestTimeoutMs;
  return config.ssrRequestTimeoutMs;
}

function routeLabel(request: Request, requestClass: RequestClass, routeTable: Route[]): string {
  if (requestClass === "api") return apiRouteLabel(new URL(request.url).pathname);
  if (requestClass === "proxy") return "<proxy>";

  const resolution = resolveRoute(new URL(request.url), config.gatewayUrl);
  if (resolution.kind === "redirect") return "<unmatched>";
  if (resolution.kind === "proxy") return "<proxy>";
  return (
    match(routeTable, resolution.pathname)?.route.path ?? infrastructureRoute(resolution.pathname)
  );
}

function apiRouteLabel(pathname: string): string {
  return KNOWN_API_ROUTES.has(pathname) ? pathname : "/api/<unmatched>";
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
