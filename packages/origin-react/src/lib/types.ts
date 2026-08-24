import type { Route as SharedRoute } from "@originloom/shared/lib/types";
import type { ReactElement } from "react";

/**
 * The route contract with its node type pinned to React, so route modules keep
 * full JSX type-checking. Structurally this is the neutral
 * `@originloom/shared/lib/types` `Route` — a `Route[]` from this module is
 * accepted anywhere the server core asks for the neutral shape.
 */
export type Route<T = unknown, A = unknown> = SharedRoute<T, ReactElement, A>;

export function defineRoute<T, A = unknown>(r: Route<T, A>): Route<T, A> {
  return r;
}

export type {
  ActionCtx,
  CachePolicy,
  Ctx,
  LoaderResult,
  RouteCacheDescription,
  RouteCacheResolver,
  RouteError,
  RouteErrorBoundaryProps,
} from "@originloom/shared/lib/types";
export { notFound, redirect, routeError } from "@originloom/shared/lib/types";
