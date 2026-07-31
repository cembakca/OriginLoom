import {
  gatewayFetch,
  gatewayFetchWithIdentity,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import * as cache from "@originloom/core/cache";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { GatewayContracts } from "@server/services/gateway-contracts";

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
export async function fetchRouteDomains(request?: Request): Promise<RouteDomains> {
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

  // The snapshot is shared, so identity here is telemetry rather than a content
  // dimension — and a refresh triggered by a background task has no request to
  // read it from.
  const response = request
    ? await gatewayFetchWithIdentity(request, "/routing/domains")
    : await gatewayFetch("/routing/domains");
  await requireGatewayOk(response, "Route domains gateway returned");

  const payload = await readGatewayJson(
    response,
    GatewayContracts.routeDomains,
    INVALID_ROUTE_DOMAINS,
  );
  const domains = normalizeRouteDomains(
    requireGatewayPayload(
      GatewayContracts.routeDomains,
      payload,
      isRouteDomains,
      INVALID_ROUTE_DOMAINS,
    ),
  );
  if (key) await cache.write(key, JSON.stringify(domains), policy);
  return domains;
}

export async function isKnownRecoursePage(
  page: string | undefined,
  request?: Request,
): Promise<boolean> {
  if (!page || !isBoundedRouteSlug(page)) return false;
  return (await fetchRouteDomains(request)).recoursePages.includes(page);
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
