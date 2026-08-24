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
  bivarianceHack(props: RouteErrorBoundaryProps<E>): TNode;
}["bivarianceHack"];

type RouteNotFoundComponent<TNode> = () => TNode;

/**
 * Bivariant like `RouteComponent`, and for the same reason: a `Route<Data,
 * _, Action>` has to stay assignable to the neutral `Route` the route table
 * holds, and a loader that reads a narrower `ctx.action` is contravariant in
 * exactly the way that would forbid it.
 */
type RouteLoader<T, A> = {
  bivarianceHack(ctx: ActionCtx<A>): Promise<LoaderResult<T>>;
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
  /**
   * Values published by product middleware for this request — locale, tenant,
   * experiment bucket. Present only for the paths that middleware ran on.
   */
  values?: Readonly<Record<string, string>>;
  /** Per-response CSP nonce for React streaming runtime scripts. */
  cspNonce?: string;
  /** Document SSR request id — embedded for client error correlation only. */
  pageRequestId?: string;
  /**
   * What this request's form action returned, when one ran and returned data.
   *
   * Only ever present on a submission: a GET render never sees it, which is why
   * the same component can render the empty form and the rejected one without
   * asking which it is.
   */
  action?: unknown;
};

/** The context a route's loader sees, with its own action result typed. */
export type ActionCtx<A> = Ctx & { action?: A };

/**
 * How the rendered HTML may be reused.
 *
 * `key` is the ONLY thing that fragments the cache. If a value is not in the
 * key, the same HTML is served regardless of that value. This is the entire
 * mechanism — there is no inference step that can override it.
 */
export type CachePolicy =
  | { kind: "none" }
  | {
      kind: "shared";
      ttl: number;
      swr?: number;
      key: string[];
      /** Stable public dependency tags used for bounded invalidation. */
      tags?: readonly string[];
    };

/** Build-time description attached to a route cache resolver. Runtime policy remains authoritative. */
export type RouteCacheDescription =
  | { mode: "none"; label?: string }
  | {
      mode: "shared" | "conditional";
      ttl: number;
      swr?: number;
      /** Human-readable cache-key dimensions, never request values or secrets. */
      vary?: readonly string[];
      label?: string;
    };

export type RouteCacheResolver = ((ctx: Ctx) => CachePolicy) & {
  readonly [routeCacheDescriptionSymbol]?: RouteCacheDescription;
};

export const routeCacheDescriptionSymbol = Symbol.for("originloom.route-cache-description");

export type RouteError = {
  /** Stable, machine-readable domain code. */
  code: string;
  /** Safe to show to the user. Never put stack traces or secrets here. */
  message: string;
};

/** Safe values exposed to a route error boundary. The original exception never crosses this seam. */
export type RouteErrorBoundaryProps<E = RouteError> = {
  error: E | null;
  status: number;
  /** Opaque server-side reference that support can correlate with structured logs. */
  errorId: string;
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

export type Route<T = unknown, TNode = unknown, A = unknown> = {
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
  cache?: RouteCacheResolver;

  /**
   * Handles a submission to this route's own path — the form's `action` is the
   * page it lives on, so there is no second URL to keep in step.
   *
   * A form is the one interactive control a browser ships on its own, and it
   * works before a single byte of JavaScript arrives. Keeping the handler on the
   * route is what lets that keep being true: the browser posts, this runs, and
   * the page comes back rendered by the same component that drew the empty form.
   *
   * Two ways out, and they are the two the web already had:
   *
   * - `redirect(location, 303)` — the success path. Post/Redirect/Get, so a
   *   reload or a back button re-runs a GET instead of re-submitting.
   * - `{ data, status }` — the rejected path. The result reaches the loader as
   *   `ctx.action`, so the page can redraw the form with its errors and the
   *   visitor's own values still in it. Send a 4xx status; a rejected
   *   submission that answers 200 lies to every client that is not a browser.
   *
   * A route without an action answers 405 to anything but GET and HEAD: a page
   * that cannot accept a submission should say so rather than quietly render.
   *
   * Never cached, in either direction. The response carries `no-store` and the
   * request neither reads nor fills the HTML cache.
   */
  action?: (ctx: Ctx) => Promise<LoaderResult<A>>;

  /** Runs on cache miss. Free to be async and to hit your API. */
  loader: RouteLoader<T, A>;

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

export function defineRoute<T, TNode = unknown, A = unknown>(
  r: Route<T, TNode, A>,
): Route<T, TNode, A> {
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
