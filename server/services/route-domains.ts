import { gatewayFetch } from "@originloom/core/adapters/gateway";
import * as cache from "@originloom/core/cache";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedRouteSlug } from "@originloom/react/lib/content-values";

const ROUTE_DOMAINS_CACHE_KEY = "route-domains";
const MAX_DOMAIN_VALUES = 500;
const INVALID_ROUTE_DOMAINS = "Route domains gateway returned an invalid payload";

export type RouteDomains = {
  recoursePages: string[];
};

/**
 * Business route values are owned by the gateway/CMS, not deployment env.
 * The validated snapshot is shared through Redis so param validation happens
 * before page-cache lookup without calling the gateway for every request.
 */
export async function fetchRouteDomains(signal?: AbortSignal): Promise<RouteDomains> {
  const policy = {
    kind: "shared" as const,
    ttl: 300,
    swr: 0,
    key: [ROUTE_DOMAINS_CACHE_KEY],
  };
  const key = cache.cacheKey(policy);

  if (key) {
    const hit = await cache.read(key);
    if (hit) {
      try {
        const cached: unknown = JSON.parse(hit.body);
        if (isRouteDomains(cached)) return normalizeRouteDomains(cached);
      } catch {
        // Corrupt/old snapshots are removed and fetched again below.
      }
      await cache.deleteKey(key);
    }
  }

  const response = await gatewayFetch("/routing/domains", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Route domains gateway returned ${response.status}`);

  const payload = await readGatewayJson(response, "route_domains", INVALID_ROUTE_DOMAINS);
  const domains = normalizeRouteDomains(
    requireGatewayPayload("route_domains", payload, isRouteDomains, INVALID_ROUTE_DOMAINS),
  );
  if (key) await cache.write(key, JSON.stringify(domains), policy);
  return domains;
}

export async function isKnownRecoursePage(
  page: string | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!page || !isBoundedRouteSlug(page)) return false;
  return (await fetchRouteDomains(signal)).recoursePages.includes(page);
}

function isRouteDomains(value: unknown): value is RouteDomains {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const domains = value as Record<string, unknown>;
  return isSlugList(domains.recoursePages);
}

function isSlugList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_DOMAIN_VALUES &&
    value.every((item) => typeof item === "string" && isBoundedRouteSlug(item))
  );
}

function normalizeRouteDomains(domains: RouteDomains): RouteDomains {
  return {
    recoursePages: [...new Set(domains.recoursePages)].sort(),
  };
}
