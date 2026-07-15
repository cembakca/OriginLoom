import type { ReactElement } from "react";

/**
 * Everything a route is allowed to know about the incoming request.
 * `request` is the standard WHATWG Request. There is no wrapper, no proxy,
 * and no instrumentation around it. Reading from it has no side effects.
 */
export type Ctx = {
  request: Request;
  params: Record<string, string>;
  url: URL;
};

/**
 * How the rendered HTML may be reused.
 *
 * `key` is the ONLY thing that fragments the cache. If a value is not in the
 * key, the same HTML is served regardless of that value. This is the entire
 * mechanism — there is no inference step that can override it.
 */
export type CachePolicy =
  | { kind: "none" }
  | { kind: "shared"; ttl: number; swr?: number; key: string[] };

export type LoaderResult<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
};

export type Route<T = any> = {
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

  Component: (props: { data: T }) => ReactElement;

  title?: (data: T) => string;
};

export function defineRoute<T>(r: Route<T>): Route<T> {
  return r;
}
