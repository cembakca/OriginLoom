import type { PageAnalyticsMeta } from "./analytics/types.js";
import type { ImagePreload } from "./media.js";
import type { PageMetadata } from "./metadata/types.js";

/**
 * What a route component returns is the UI framework's business, so it stays a
 * type parameter here. `@originloom/react/lib/types` pins it to `ReactElement`;
 * the server core only ever sees the `unknown` default and hands the value to
 * the installed renderer.
 */
type RouteComponent<T, TNode> = {
  bivarianceHack(props: { data: T }): TNode;
}["bivarianceHack"];

type RouteErrorComponent<E, TNode> = {
  bivarianceHack(props: { error: E | null; status: number }): TNode;
}["bivarianceHack"];

type RouteNotFoundComponent<TNode> = () => TNode;

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
  /** Per-response CSP nonce for React streaming runtime scripts. */
  cspNonce?: string;
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

export type RouteError = {
  /** Stable, machine-readable domain code. */
  code: string;
  /** Safe to show to the user. Never put stack traces or secrets here. */
  message: string;
};

type ResultHeaders = { headers?: Record<string, string> };

/**
 * Explicit route outcome. `{ data }` remains the default for concise loaders;
 * terminal outcomes never enter the HTML cache.
 */
export type LoaderResult<T> =
  | ({ kind?: "data"; data: T; status?: number } & ResultHeaders)
  | ({ kind: "notFound" } & ResultHeaders)
  | ({
      kind: "redirect";
      location: string;
      status?: 301 | 302 | 303 | 307 | 308;
    } & ResultHeaders)
  | ({ kind: "error"; error: RouteError; status?: number } & ResultHeaders);

export type Route<T = unknown, TNode = unknown> = {
  path: string;
  streaming?: boolean;

  /**
   * Resolves dynamic route-domain membership before cache lookup. False is a
   * route 404 and can never read or populate a page cache entry.
   */
  validateParams?: (ctx: Ctx) => boolean | Promise<boolean>;

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

  Component: RouteComponent<T, TNode>;

  /** Route-local 404 view. Omit to use the application NotFoundPage. */
  NotFoundComponent?: RouteNotFoundComponent<TNode>;

  /**
   * Route-local error view. `error` is null for unexpected exceptions so the
   * original message/stack can never accidentally leak into HTML.
   */
  ErrorComponent?: RouteErrorComponent<RouteError, TNode>;

  /**
   * Route SEO override (Next.js generateMetadata karşılığı).
   * Loader'dan gelen seoInfo ile beslenir — ayrı fetch yapma.
   */
  generateMetadata?: RouteDataCallback<T, PageMetadata>;

  /** LCP candidates emitted as <link rel="preload" as="image"> in the document head. */
  preloadImages?: RouteDataCallback<T, ImagePreload[]>;

  /** Additional eager island chunks to modulepreload for this route. Deferred islands stay lazy. */
  preloadIslands?: readonly string[];

  /** @deprecated Prefer generateMetadata */
  title?: RouteTitleCallback<T>;

  /** GTM page-view metadata — cache-safe fields only (no trackingId / tokens). */
  pageMeta?: RouteDataCallback<T, PageAnalyticsMeta>;

  /** Minimal chrome for redirect / terminal routes. */
  minimalChrome?: boolean;
};

export function defineRoute<T, TNode = unknown>(r: Route<T, TNode>): Route<T, TNode> {
  return r;
}

export function notFound(headers?: Record<string, string>): LoaderResult<never> {
  return { kind: "notFound", ...(headers ? { headers } : {}) };
}

export function redirect(
  location: string,
  status: 301 | 302 | 303 | 307 | 308 = 307,
  headers?: Record<string, string>,
): LoaderResult<never> {
  return { kind: "redirect", location, status, ...(headers ? { headers } : {}) };
}

export function routeError(
  error: RouteError,
  status = 500,
  headers?: Record<string, string>,
): LoaderResult<never> {
  return { kind: "error", error, status, ...(headers ? { headers } : {}) };
}
