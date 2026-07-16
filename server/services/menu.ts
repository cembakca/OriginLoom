import { gatewayFetchForRequest } from "@server/adapters/gateway";
import * as cache from "@server/cache";
import { config, runtimeMocksEnabled } from "@server/config";

import { menuCacheKey } from "~/lib/cache-keys";
import type { DeviceType } from "~/lib/device";
import type { IMenuItems, MenuItem } from "~/lib/menu/types";

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
  try {
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
  } catch (error) {
    if (runtimeMocksEnabled()) return mockMenuItems();
    throw error;
  }
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

function mockMenuItems(): IMenuItems {
  const headerItems: MenuItem[] = [
    {
      id: 1,
      name: "Kredi",
      url: "/ihtiyac-kredisi/istanbul",
      displayOrder: 1,
      mobileDisplayOrder: 1,
      itemType: 4,
      subMenuItemList: [
        {
          id: 11,
          parentId: 1,
          name: "İhtiyaç Kredisi",
          url: "/ihtiyac-kredisi/istanbul",
          displayOrder: 1,
          mobileDisplayOrder: 1,
          itemType: 4,
        },
        {
          id: 12,
          parentId: 1,
          name: "Emekli Bankacılığı",
          hamburgerName: "Emekli",
          url: "/emekli-bankaciligi",
          displayOrder: 2,
          mobileDisplayOrder: 2,
          itemType: 4,
        },
      ],
    },
    {
      id: 2,
      name: "Blog",
      url: "/blogs/paginated",
      displayOrder: 2,
      mobileDisplayOrder: 3,
      itemType: 4,
    },
  ];

  const footerItems: MenuItem[] = [
    {
      id: 100,
      name: "Hakkımızda",
      url: "/hakkimizda",
      displayOrder: 1,
      mobileDisplayOrder: 1,
      itemType: 16,
    },
    {
      id: 101,
      name: "Gizlilik",
      url: "/gizlilik.pdf",
      displayOrder: 2,
      mobileDisplayOrder: 2,
      itemType: 16,
    },
    {
      id: 102,
      name: "İletişim",
      url: "/iletisim",
      displayOrder: 3,
      mobileDisplayOrder: 3,
      itemType: 16,
    },
  ];

  return { headerItems, hamburgerItems: headerItems, footerItems };
}
