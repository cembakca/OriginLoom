import { Cookie } from "./cookies.js";
import { cookie } from "./request.js";
import {
  type CachePolicy,
  type Ctx,
  type RouteCacheDescription,
  routeCacheDescriptionSymbol,
  type RouteCacheResolver,
} from "./types.js";

/**
 * Return true → HTML cache BYPASS (loader runs every time).
 * Checks run in registration order; any match skips cache.
 *
 * Register only concerns that affect every shared route. Route-specific personalization belongs
 * in the route registry via a local bypass check.
 */
export type CacheBypassCheck = (ctx: Ctx) => boolean;

export type SharedCacheOptions = {
  ttl?: number;
  swr?: number;
  /** Route-local bypass checks (merged with global registry). */
  bypass?: CacheBypassCheck | CacheBypassCheck[];
  /** Always skip cache regardless of bypass checks (e.g. account pages). */
  never?: boolean;
};

const globalBypassChecks: CacheBypassCheck[] = [];

/** Register a global bypass rule — call at app bootstrap to extend behavior. */
export function registerCacheBypassCheck(check: CacheBypassCheck): void {
  globalBypassChecks.push(check);
}

export function clearCacheBypassChecks(): void {
  globalBypassChecks.length = 0;
}

/** Authoritative auth presence for routes whose SSR HTML actually varies by session. */
export function isAuthenticated(ctx: Ctx): boolean {
  return Boolean(
    ctx.request.headers.get("Authorization") ||
    cookie(ctx.request, Cookie.accessToken) ||
    cookie(ctx.request, Cookie.refreshToken),
  );
}

/** Example extension point — enable when PID-based personalization is needed. */
export function hasPid(ctx: Ctx): boolean {
  return Boolean(cookie(ctx.request, Cookie.pid));
}

function shouldBypass(ctx: Ctx, opts?: SharedCacheOptions): boolean {
  if (opts?.never) return true;

  const local = opts?.bypass ? (Array.isArray(opts.bypass) ? opts.bypass : [opts.bypass]) : [];

  return [...globalBypassChecks, ...local].some((check) => check(ctx));
}

/**
 * Anonymous visitors → shared HTML cache (HIT/MISS).
 * A configured route/global bypass check passes → `{ kind: "none" }` (x-cache: BYPASS).
 */
export function sharedUnlessBypass(
  ctx: Ctx,
  key: string[],
  opts: SharedCacheOptions = {},
): CachePolicy {
  if (shouldBypass(ctx, opts)) return { kind: "none" };

  return {
    kind: "shared",
    ttl: opts.ttl ?? 300,
    swr: opts.swr ?? 86_400,
    key,
  };
}

/** Route is never cached (always BYPASS). */
export function neverCache(): CachePolicy {
  return { kind: "none" };
}

/**
 * Attaches build-readable metadata to the real runtime resolver. The resolver
 * remains the source of truth; an unannotated resolver is reported as runtime-defined.
 */
export function describeRouteCache(
  resolver: (ctx: Ctx) => CachePolicy,
  description: RouteCacheDescription,
): RouteCacheResolver {
  Object.defineProperty(resolver, routeCacheDescriptionSymbol, {
    value: Object.freeze(description),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return resolver;
}

export function routeCacheDescription(
  resolver: ((ctx: Ctx) => CachePolicy) | undefined,
): RouteCacheDescription | undefined {
  return (resolver as RouteCacheResolver | undefined)?.[routeCacheDescriptionSymbol];
}

Object.defineProperty(neverCache, routeCacheDescriptionSymbol, {
  value: Object.freeze({ mode: "none" } satisfies RouteCacheDescription),
  enumerable: false,
  configurable: false,
  writable: false,
});
