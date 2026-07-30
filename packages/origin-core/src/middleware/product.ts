import { cookie } from "@originloom/shared/lib/request";
import { matchPattern } from "@originloom/shared/routing/pattern";

import { SpanKind, withSpan } from "../observability.js";
import type { CookieOptions } from "./cookie-jar.js";
import { cloneRequestWithHeaders } from "./sequential.js";
import type { MiddlewareStep, PipelineContext, PipelineResult } from "./types.js";

/**
 * Where a product middleware sits in the document pipeline.
 *
 * - `before-auth` — first thing that runs. Nothing has read a token or written a
 *   cookie yet, so this is where a request is turned away wholesale: maintenance
 *   mode, a geo block, a tenant that does not exist.
 * - `before-render` — after auth, session and CMS redirects, immediately before
 *   the route is matched and rendered. The session's tracking id exists here, so
 *   this is where per-visitor decisions belong: locale, experiment bucket, flags.
 */
export type MiddlewarePhase = "before-auth" | "before-render";

export type MiddlewareContext = {
  /** The request as earlier steps left it — read headers and cookies from here. */
  request: Request;
  /** Browser-visible URL, before any rewrite from `src/routing/rules.ts`. */
  url: URL;
  /** `url.pathname`: the path this middleware's own matcher ran against. */
  publicPath: string;
  /** Params captured by the matcher pattern that selected this request. */
  params: Record<string, string>;
  clientIp: string;
  requestId?: string;
  /** Session tracking id. Only set in the `before-render` phase. */
  trackingId?: string;
  /** Values published by middleware that already ran for this request. */
  values: Readonly<Record<string, string>>;
  cookie: (name: string) => string | undefined;
  header: (name: string) => string | undefined;
};

/** `null` deletes the cookie; a bare string sets it with the platform defaults. */
export type MiddlewareCookie = string | ({ value: string } & CookieOptions) | null;

/**
 * The same set a route loader may redirect with. It is a closed set on purpose:
 * a status that arrives from a CMS or a rules service is untrusted input, and
 * `new Response` turns anything outside 200..599 into a thrown request.
 */
export type MiddlewareRedirect = { location: string; status?: 301 | 302 | 303 | 307 | 308 };

export type MiddlewareResult = {
  /** Terminal response. The pipeline stops; no route is matched or rendered. */
  response?: Response;
  /** Terminal redirect. `status` defaults to 307 — say 301/308 for a permanent move. */
  redirect?: string | MiddlewareRedirect;
  /** Headers seen by loaders further down. `null` removes one. */
  requestHeaders?: Record<string, string | null>;
  /** Headers added to whatever response this request ends up producing. */
  responseHeaders?: Record<string, string>;
  cookies?: Record<string, MiddlewareCookie>;
  /**
   * Request-scoped values, readable as `ctx.values` in loaders, cache resolvers
   * and later middleware.
   *
   * Every value fragments the shared HTML cache by default: if a value changes
   * what a page renders, one visitor's HTML must not be served to another. Opt a
   * value out with `cacheVary` only when it provably cannot change the HTML.
   */
  values?: Record<string, string>;
  /**
   * Which of this middleware's `values` fragment the shared HTML cache.
   * Defaults to all of them; `[]` means none of them do.
   */
  cacheVary?: readonly string[];
};

export type OriginMiddleware = {
  /** Stable identifier — appears in traces and in startup validation errors. */
  name: string;
  /** Defaults to `before-render`. */
  phase?: MiddlewarePhase;
  /**
   * Paths this middleware runs for, in `src/routing/rules.ts` pattern syntax
   * (`/urunler/:slug`, `/hesap/:path*`). Omit to run for every document request.
   */
  matcher?: readonly string[];
  /**
   * Paths it never runs for, checked before `matcher` and winning over it.
   *
   * An allowlist alone cannot say "every page except this branch", which is the
   * shape most cross-cutting rules actually have: `matcher: ["/:path*"]` with
   * `exclude: ["/api/:path*"]` is a rule about documents, not about endpoints.
   */
  exclude?: readonly string[];
  handler: (ctx: MiddlewareContext) => void | MiddlewareResult | Promise<void | MiddlewareResult>;
};

export type CompiledMiddleware = {
  beforeAuth: MiddlewareStep[];
  beforeRender: MiddlewareStep[];
};

/**
 * Request headers the platform owns. A product middleware that could overwrite
 * `authorization` would be an authentication bypass with extra steps.
 */
const RESERVED_REQUEST_HEADERS = new Set(["authorization", "cookie", "x-pathname", "x-client-ip"]);

/** Set-Cookie is a list header; `cookies` is the only way to append to it safely. */
const RESERVED_RESPONSE_HEADERS = new Set(["set-cookie"]);

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const VALUE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/i;
/** A cache key part is stored, logged and purged by hand — it stays human-sized. */
const MAX_VALUE_LENGTH = 128;

/** Identity function that validates the shape at module load instead of at request time. */
export function defineMiddleware(middleware: OriginMiddleware): OriginMiddleware {
  assertValidMiddleware(middleware);
  return middleware;
}

/** Compile the product's list into pipeline steps, grouped by phase. Order is preserved. */
export function compileMiddleware(middleware: readonly OriginMiddleware[]): CompiledMiddleware {
  const seen = new Set<string>();
  const compiled: CompiledMiddleware = { beforeAuth: [], beforeRender: [] };

  for (const entry of middleware) {
    assertValidMiddleware(entry);
    if (seen.has(entry.name)) {
      throw new Error(`Duplicate middleware name: ${entry.name}`);
    }
    seen.add(entry.name);
    const step = toStep(entry);
    if ((entry.phase ?? "before-render") === "before-auth") compiled.beforeAuth.push(step);
    else compiled.beforeRender.push(step);
  }

  return compiled;
}

function assertValidMiddleware(middleware: OriginMiddleware): void {
  if (!NAME_PATTERN.test(middleware.name ?? "")) {
    throw new Error(
      `Invalid middleware name: ${String(middleware.name)} — use kebab-case, e.g. "locale"`,
    );
  }
  if (typeof middleware.handler !== "function") {
    throw new Error(`Middleware ${middleware.name} has no handler function`);
  }
  if (
    middleware.phase !== undefined &&
    middleware.phase !== "before-auth" &&
    middleware.phase !== "before-render"
  ) {
    throw new Error(
      `Middleware ${middleware.name} has an unknown phase: ${String(middleware.phase)}`,
    );
  }
  for (const pattern of middleware.matcher ?? []) {
    if (!pattern.startsWith("/")) {
      throw new Error(`Middleware ${middleware.name} matcher must start with "/": ${pattern}`);
    }
  }
  for (const pattern of middleware.exclude ?? []) {
    if (!pattern.startsWith("/")) {
      throw new Error(`Middleware ${middleware.name} exclude must start with "/": ${pattern}`);
    }
  }
}

function toStep(middleware: OriginMiddleware): MiddlewareStep {
  const { matcher, exclude } = middleware;
  return async (ctx, acc) => {
    if (matchesAny(exclude, ctx.publicPath)) return;
    const params = matchMiddleware(matcher, ctx.publicPath);
    if (!params) return;

    const result = await withSpan(
      `middleware.${middleware.name}`,
      { kind: SpanKind.INTERNAL, attributes: { "originloom.middleware": middleware.name } },
      async () => middleware.handler(createContext(ctx, acc, params)),
    );
    return result ? applyResult(middleware, result, acc, ctx) : undefined;
  };
}

function matchMiddleware(
  matcher: readonly string[] | undefined,
  publicPath: string,
): Record<string, string> | null {
  if (!matcher || matcher.length === 0) return {};
  for (const pattern of matcher) {
    const params = matchPattern(pattern, publicPath);
    if (params) return params;
  }
  return null;
}

function matchesAny(patterns: readonly string[] | undefined, publicPath: string): boolean {
  return Boolean(patterns?.some((pattern) => matchPattern(pattern, publicPath)));
}

function createContext(
  ctx: PipelineContext,
  acc: PipelineResult,
  params: Record<string, string>,
): MiddlewareContext {
  return {
    request: acc.request,
    url: ctx.url,
    publicPath: ctx.publicPath,
    params,
    clientIp: ctx.clientIp,
    ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
    ...(acc.trackingId !== undefined ? { trackingId: acc.trackingId } : {}),
    values: acc.values ?? {},
    cookie: (name) => cookie(acc.request, name),
    header: (name) => acc.request.headers.get(name) ?? undefined,
  };
}

function applyResult(
  middleware: OriginMiddleware,
  result: MiddlewareResult,
  acc: PipelineResult,
  ctx: PipelineContext,
): Partial<PipelineResult> {
  if (result.response && result.redirect) {
    throw new Error(`Middleware ${middleware.name} returned both a response and a redirect`);
  }
  const patch: Partial<PipelineResult> = {};

  if (result.cookies) patch.cookies = applyCookies(result.cookies, acc);
  if (result.requestHeaders) patch.request = applyRequestHeaders(middleware, result, acc);
  if (result.responseHeaders) patch.responseHeaders = applyResponseHeaders(middleware, result);
  if (result.values) Object.assign(patch, applyValues(middleware, result));

  const terminal = terminalResponse(result, ctx.url);
  if (terminal) patch.response = terminal;
  return patch;
}

function applyCookies(cookies: Record<string, MiddlewareCookie>, acc: PipelineResult) {
  for (const [name, entry] of Object.entries(cookies)) {
    if (entry === null) acc.cookies.delete(name);
    else if (typeof entry === "string") acc.cookies.set(name, entry);
    else {
      const { value, ...options } = entry;
      acc.cookies.set(name, value, options);
    }
  }
  return acc.cookies;
}

function applyRequestHeaders(
  middleware: OriginMiddleware,
  result: MiddlewareResult,
  acc: PipelineResult,
): Request {
  const headers = new Headers(acc.request.headers);
  for (const [name, value] of Object.entries(result.requestHeaders ?? {})) {
    if (RESERVED_REQUEST_HEADERS.has(name.toLowerCase())) {
      throw new Error(`Middleware ${middleware.name} may not set the ${name} request header`);
    }
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return cloneRequestWithHeaders(acc.request, headers);
}

function applyResponseHeaders(middleware: OriginMiddleware, result: MiddlewareResult): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(result.responseHeaders ?? {})) {
    if (RESERVED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      throw new Error(
        `Middleware ${middleware.name} may not set ${name} — return \`cookies\` instead`,
      );
    }
    headers.set(name, value);
  }
  return headers;
}

function applyValues(
  middleware: OriginMiddleware,
  result: MiddlewareResult,
): Pick<PipelineResult, "values" | "cacheVary"> {
  const values = result.values ?? {};
  for (const [name, value] of Object.entries(values)) {
    if (!VALUE_NAME_PATTERN.test(name)) {
      throw new Error(`Middleware ${middleware.name} published an invalid value name: ${name}`);
    }
    if (value.length > MAX_VALUE_LENGTH) {
      throw new Error(
        `Middleware ${middleware.name} value "${name}" exceeds ${MAX_VALUE_LENGTH} characters`,
      );
    }
  }
  const varied = (result.cacheVary ?? Object.keys(values)).filter(
    (name) => values[name] !== undefined,
  );
  return { values, cacheVary: varied };
}

function terminalResponse(result: MiddlewareResult, url: URL): Response | undefined {
  if (result.response) return result.response;
  if (!result.redirect) return undefined;

  const redirect: MiddlewareRedirect =
    typeof result.redirect === "string" ? { location: result.redirect } : result.redirect;
  return new Response(null, {
    status: redirect.status ?? 307,
    headers: {
      location: new URL(redirect.location, url).toString(),
      // A middleware redirect is a decision about this visitor — a cookie, a
      // flag, a bucket. Nothing in front of the app may reuse it for the next one.
      "cache-control": "private, no-store",
      "x-cache": "BYPASS",
    },
  });
}
