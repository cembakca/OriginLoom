import {
  gatewayFetchWithIdentity,
  releaseGatewayResponse,
} from "@originloom/core/adapters/gateway";
import { readGatewayJson } from "@originloom/core/gateway-payload";
import { logger } from "@originloom/core/logger";
import { defineMiddleware, type MiddlewareRedirect } from "@originloom/core/middleware";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import { isRecord } from "@originloom/shared/lib/runtime-schema";
import { GatewayContracts } from "@server/services/gateway-contracts";

/**
 * Asks a service what to do with the URL a visitor asked for, before the page is
 * matched: it either names a destination, or says to carry on.
 *
 * Why a service instead of `src/routing/rules.ts`: those rules ship with a
 * deploy. These come from whoever curates the site's history — a campaign tool,
 * an SEO team — and change without one.
 */
export const redirectRulesMiddleware = defineMiddleware({
  name: "redirect-rules",
  // Nothing has read a token or written a cookie yet: a URL that moved should not
  // cost a session refresh on the way to a 301.
  phase: "before-auth",
  // Every document, and only documents. An endpoint is not a page and has no
  // redirect rules to look up, so it must not pay for this call — and an
  // /api/internal/* path with no handler does reach this pipeline.
  matcher: ["/:path*"],
  exclude: ["/api/:path*"],
  handler: async (ctx) => {
    const rule = await decide(ctx.url, ctx.request);
    // No rule is the common case: return nothing and the request carries on to
    // auth, session and the route it was always going to render.
    return rule ? { redirect: rule } : undefined;
  },
});

/** The closed set a redirect may carry; anything else the service invents is not obeyed. */
const REDIRECT_STATUS = [301, 302, 303, 307, 308] as const;

/**
 * One lookup per URL per minute, not one per request. Without this every page
 * view pays a gateway round trip before it may render — the platform's own CMS
 * redirect step caches for the same reason (`REDIRECT_CACHE_TTL_MS`).
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1_000;
const cache = new Map<string, { value: MiddlewareRedirect | null; expiresAt: number }>();

async function decide(url: URL, request: Request): Promise<MiddlewareRedirect | null> {
  const key = url.pathname;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const response = await gatewayFetchWithIdentity(
      request,
      `/routing/decide?url=${encodeURIComponent(url.toString())}`,
    );
    if (!response.ok) {
      await releaseGatewayResponse(response);
      // An unanswered lookup is not "no rule": do not cache it as one.
      return null;
    }
    const payload = await readGatewayJson(
      response,
      GatewayContracts.routing,
      "Routing gateway returned an invalid payload",
    );
    return remember(key, parseDecision(payload));
  } catch (error) {
    // The deadline is the platform's to answer; everything else fails open,
    // because a routing service being down must not take the site down with it.
    if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
    if (isRequestDeadlineError(error)) throw error;
    logger.warn("routing decision unavailable", {
      pathname: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Gateway JSON is untrusted input: a status it invents must never reach a Response. */
function parseDecision(payload: unknown): MiddlewareRedirect | null {
  if (!isRecord(payload) || payload.action !== "redirect") return null;
  if (typeof payload.location !== "string" || !sameSite(payload.location)) return null;
  const status = REDIRECT_STATUS.find((allowed) => allowed === payload.status) ?? 307;
  return { location: payload.location, status };
}

/**
 * Same-site destinations only. A rules service that can point visitors at any
 * host is an open redirect with a nice API; sending them off-site is a decision
 * this app makes on purpose, against a list it owns.
 */
function sameSite(location: string): boolean {
  return location.startsWith("/") && !location.startsWith("//") && location.length <= 2_048;
}

function remember(key: string, value: MiddlewareRedirect | null): MiddlewareRedirect | null {
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
