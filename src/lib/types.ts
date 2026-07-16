import type { ReactElement } from "react";

import type { PageAnalyticsMeta } from "./analytics/types";
import type { PageMetadata } from "./metadata/types";

type RouteComponent<T> = {
  bivarianceHack(props: { data: T }): ReactElement;
}["bivarianceHack"];

type RouteDataCallback<T, R> = {
  bivarianceHack(data: T, ctx: Ctx): R;
}["bivarianceHack"];

type RouteTitleCallback<T> = {
  bivarianceHack(data: T): string;
}["bivarianceHack"];

/**
 * Everything a route is allowed to know about the incoming request.
 * `request` is the standard WHATWG Request. There is no wrapper, no proxy,
 * and no instrumentation around it. Reading from it has no side effects.
 */
export type Ctx = {
  request: Request;
  params: Record<string, string>;
  /** URL after rewrite — query string preserved, pathname is internal. */
  url: URL;
  /** Browser-visible path before rewrite. Use in cache keys and canonical URLs. */
  publicPath: string;
  /** Public origin injected by the server; used for canonical/OG URLs. */
  siteUrl?: string;
  /** Set by session middleware when pipeline runs. */
  trackingId?: string;
};

/**
 * How the rendered HTML may be reused.
 *
 * `key` is the ONLY thing that fragments the cache. If a value is not in the
 * key, the same HTML is served regardless of that value. This is the entire
 * mechanism — there is no inference step that can override it.
 */
export type CachePolicy =
  { kind: "none" } | { kind: "shared"; ttl: number; swr?: number; key: string[] };

export type LoaderResult<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
};

export type Route<T = unknown> = {
  path: string;

  /**
   * Runs BEFORE the loader. Pure, synchronous, cheap.
   *
   * This is the answer to "reading a cookie changes how the page renders".
   * Here, reading a cookie changes nothing unless you put it in `key`.
   * Omit this function entirely and the route is simply never cached.
   */
  cache?: (ctx: Ctx) => CachePolicy;

  /** Runs on cache miss. Free to be async and to hit your API. */
  loader: (ctx: Ctx) => Promise<LoaderResult<T>>;

  Component: RouteComponent<T>;

  /**
   * Route SEO override (Next.js generateMetadata karşılığı).
   * Loader'dan gelen seoInfo ile beslenir — ayrı fetch yapma.
   */
  generateMetadata?: RouteDataCallback<T, PageMetadata>;

  /** @deprecated Prefer generateMetadata */
  title?: RouteTitleCallback<T>;

  /** GTM page-view metadata — cache-safe fields only (no trackingId / tokens). */
  pageMeta?: RouteDataCallback<T, PageAnalyticsMeta>;

  /** Minimal chrome for redirect / terminal routes. */
  minimalChrome?: boolean;
};

export function defineRoute<T>(r: Route<T>): Route<T> {
  return r;
}
