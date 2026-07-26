import type { Route as SharedRoute } from "@originloom/shared/lib/types";
import type { ReactElement } from "react";

/**
 * The route contract with its node type pinned to React, so route modules keep
 * full JSX type-checking. Structurally this is the neutral
 * `@originloom/shared/lib/types` `Route` — a `Route[]` from this module is
 * accepted anywhere the server core asks for the neutral shape.
 */
export type Route<T = unknown> = SharedRoute<T, ReactElement>;

export function defineRoute<T>(r: Route<T>): Route<T> {
  return r;
}

export type { CachePolicy, Ctx, LoaderResult, RouteError } from "@originloom/shared/lib/types";
export { notFound, redirect, routeError } from "@originloom/shared/lib/types";
