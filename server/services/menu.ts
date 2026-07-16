import { gatewayFetchForRequest } from "@server/adapters/gateway";
import * as cache from "@server/cache";
import { config } from "@server/config";

import { menuCacheKey } from "~/lib/cache-keys";
import type { DeviceType } from "~/lib/device";
import type { IMenuItems } from "~/lib/menu/types";

/** Public menu endpoint — device header ile tek fetch; uzun TTL API cache. */
export async function fetchMenuList(request: Request, device: DeviceType): Promise<IMenuItems> {
  const key = menuCacheKey(device);
  const policy = {
    kind: "shared" as const,
    ttl: config.menuCacheTtl,
    swr: config.menuCacheSwr,
    key: [key],
  };
  const cacheKey = cache.cacheKey(policy);

  if (cacheKey) {
    const hit = await cache.read(cacheKey);
    if (hit) {
      try {
        const cached: unknown = JSON.parse(hit.body);
        if (isMenuPayload(cached)) return normalizeMenuItems(cached);
      } catch {
        // Corrupt/old entries are treated as a miss and replaced below.
      }
      await cache.deleteKey(cacheKey);
    }
  }

  const data = await fetchMenuFromGateway(request, device);

  if (cacheKey) {
    await cache.write(cacheKey, JSON.stringify(data), policy);
  }

  return data;
}

async function fetchMenuFromGateway(request: Request, device: DeviceType): Promise<IMenuItems> {
  const res = await gatewayFetchForRequest(request, "/pages/menuitem/list", {
    headers: {
      "content-type": "application/json",
      device,
      CorrelationId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
  });

  if (!res.ok) throw new Error(`Menu gateway returned ${res.status}`);

  const data: unknown = await res.json();
  if (!isMenuPayload(data)) throw new Error("Menu gateway returned an invalid payload");
  return normalizeMenuItems(data);
}

function isMenuPayload(data: unknown): data is Partial<IMenuItems> {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return ["headerItems", "hamburgerItems", "footerItems"].every(
    (key) => value[key] === undefined || Array.isArray(value[key]),
  );
}

function normalizeMenuItems(data: Partial<IMenuItems>): IMenuItems {
  const headerItems = data.headerItems ?? data.hamburgerItems ?? [];
  return {
    headerItems,
    hamburgerItems: data.hamburgerItems ?? headerItems,
    footerItems: data.footerItems ?? [],
  };
}
