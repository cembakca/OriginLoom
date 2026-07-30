import type { CachePolicy } from "@originloom/shared/lib/types";

import type { HandleContext } from "./types.js";

/**
 * Fold the middleware values a request varies on into the route's cache key.
 *
 * The route decides what it caches; a middleware that changes what a page
 * renders decides what that HTML may be reused for. Without this, a locale or an
 * experiment bucket injected by middleware would be invisible to the cache and
 * one visitor's HTML would be served to the next.
 *
 * Names are sorted so the key is the same however the middleware list is ordered.
 */
export function applyMiddlewareCacheVary(policy: CachePolicy, ctx: HandleContext): CachePolicy {
  if (policy.kind !== "shared") return policy;
  const names = ctx.cacheVary;
  if (!names || names.length === 0) return policy;

  const values = ctx.values ?? {};
  const parts = [...new Set(names)]
    .sort()
    .filter((name) => values[name] !== undefined)
    .map((name) => `${name}=${values[name]}`);

  return parts.length === 0 ? policy : { ...policy, key: [...policy.key, ...parts] };
}
