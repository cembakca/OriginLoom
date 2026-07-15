import * as cache from "@server/cache";

import { menuCacheKey } from "~/lib/cache-keys";
import type { DeviceType } from "~/lib/device";
import { gatewayFetch } from "~/lib/gateway-fetch";
import type { IMenuItems, MenuItem } from "~/lib/menu/types";

const MENU_CACHE_TTL = Number(process.env.MENU_CACHE_TTL ?? 14_400);
const MENU_CACHE_SWR = Number(process.env.MENU_CACHE_SWR ?? 86_400);

/** Public menu endpoint — device header ile tek fetch; uzun TTL API cache. */
export async function fetchMenuList(request: Request, device: DeviceType): Promise<IMenuItems> {
  const key = menuCacheKey(device);
  const policy = { kind: "shared" as const, ttl: MENU_CACHE_TTL, swr: MENU_CACHE_SWR, key: [key] };
  const cacheKey = cache.cacheKey(policy);

  if (cacheKey) {
    const hit = await cache.read(cacheKey);
    if (hit) return JSON.parse(hit.body) as IMenuItems;
  }

  const data = await fetchMenuFromGateway(request, device);

  if (cacheKey) {
    await cache.write(cacheKey, JSON.stringify(data), policy);
  }

  return data;
}

async function fetchMenuFromGateway(request: Request, device: DeviceType): Promise<IMenuItems> {
  try {
    const res = await gatewayFetch(request, "/pages/menuitem/list", {
      headers: {
        "content-type": "application/json",
        device,
        CorrelationId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
    });

    if (!res.ok) return mockMenuItems();

    const data = (await res.json()) as Partial<IMenuItems>;
    return normalizeMenuItems(data);
  } catch {
    return mockMenuItems();
  }
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
