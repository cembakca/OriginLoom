import type { Route as SharedRoute } from "@originloom/shared/lib/types";

import type { HtmlNode } from "../html.js";

/**
 * The route contract with its node type pinned to HTML nodes, so a route's
 * `Component` is checked against what `html` produces. Structurally this is the
 * neutral `@originloom/shared/lib/types` `Route` — a `Route[]` from this module
 * is accepted anywhere the server core asks for the neutral shape.
 */
export type Route<T = unknown> = SharedRoute<T, HtmlNode>;

export function defineRoute<T>(r: Route<T>): Route<T> {
  return r;
}

export type { CachePolicy, Ctx, LoaderResult, RouteError } from "@originloom/shared/lib/types";
export { notFound, redirect, routeError } from "@originloom/shared/lib/types";
