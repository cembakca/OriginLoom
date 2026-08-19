import { match } from "@originloom/shared/lib/match";
import type { Route } from "@originloom/shared/lib/types";
import { normalizePublicUrl, resolveRoute } from "@originloom/shared/routing";
import type { RouteResolution } from "@originloom/shared/routing/types";

import { config } from "../config.js";
import type { RequestClass } from "./context.js";

export type PreparedRequest = {
  url: URL;
  normalized: ReturnType<typeof normalizePublicUrl>;
  routing: RouteResolution;
  matched: { route: Route; params: Record<string, string> } | null;
  requestClass: RequestClass;
  routeLabel: string;
};

/** Parse, resolve and match once; downstream middleware reuses this immutable request identity. */
export function prepareRequest(
  request: Request,
  routes: Route[],
  apiRouteLabels: ReadonlySet<string> = new Set(),
): PreparedRequest {
  const url = new URL(request.url);
  const normalized = normalizePublicUrl(url);
  const routing = resolveRoute(url, config.gatewayUrl);
  const requestClass = classifyPrepared(url, routing);
  const matched =
    routing.kind === "none" || routing.kind === "rewrite" ? match(routes, routing.pathname) : null;
  return {
    url,
    normalized,
    routing,
    matched,
    requestClass,
    routeLabel: preparedRouteLabel(url.pathname, routing, matched, requestClass, apiRouteLabels),
  };
}

export function classifyRequest(request: Request): RequestClass {
  const url = new URL(request.url);
  return classifyPrepared(url, resolveRoute(url, config.gatewayUrl));
}

function classifyPrepared(url: URL, routing: RouteResolution): RequestClass {
  if (routing.kind === "proxy") return "proxy";
  return url.pathname === "/api" || url.pathname.startsWith("/api/") ? "api" : "ssr";
}

function preparedRouteLabel(
  pathname: string,
  routing: RouteResolution,
  matched: PreparedRequest["matched"],
  requestClass: RequestClass,
  apiRouteLabels: ReadonlySet<string>,
): string {
  if (requestClass === "api") {
    return apiRouteLabels.has(pathname) ? pathname : "/api/<unmatched>";
  }
  if (requestClass === "proxy" || routing.kind === "proxy") return "<proxy>";
  if (routing.kind === "redirect") return "<unmatched>";
  return matched?.route.path ?? infrastructureRoute(routing.pathname);
}

function infrastructureRoute(pathname: string): string {
  if (pathname.startsWith("/assets/")) return "/assets/*";
  if (pathname.startsWith("/public/")) return "/public/*";
  if (pathname === "/healthz" || pathname === "/readyz") return "<health>";
  if (pathname === "/metrics") return "<unmatched>";
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return pathname;
  return "<unmatched>";
}
