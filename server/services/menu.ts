import { gatewayFetchForRequest } from "@server/adapters/gateway";
import * as cache from "@server/cache";
import { config } from "@server/config";

import { menuCacheKey } from "~/lib/cache-keys";
import { normalizeMetadataImageUrl, normalizeNavigationUrl } from "~/lib/content-url";
import type { DeviceType } from "~/lib/device";
import type { IMenuItems, MenuItem } from "~/lib/menu/types";

const MAX_MENU_DEPTH = 3;
const MAX_MENU_ITEMS = 200;
const MAX_ITEMS_PER_LEVEL = 50;
const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

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
        const menu = parseMenuPayload(cached);
        if (menu) return menu;
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
  const menu = parseMenuPayload(data);
  if (!menu) throw new Error("Menu gateway returned an invalid payload");
  return menu;
}

function parseMenuPayload(data: unknown): IMenuItems | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const state = { count: 0 };
  const header = parseMenuList(value.headerItems, 1, state);
  const hamburger = parseMenuList(value.hamburgerItems, 1, state);
  const footer = parseMenuList(value.footerItems, 1, state);
  if (header === null || hamburger === null || footer === null) return null;

  const headerItems = header ?? hamburger ?? [];
  return {
    headerItems,
    hamburgerItems: hamburger ?? headerItems,
    footerItems: footer ?? [],
  };
}

function parseMenuList(
  value: unknown,
  depth: number,
  state: { count: number },
): MenuItem[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || depth > MAX_MENU_DEPTH || value.length > MAX_ITEMS_PER_LEVEL) {
    return null;
  }

  const items: MenuItem[] = [];
  for (const candidate of value) {
    state.count++;
    if (state.count > MAX_MENU_ITEMS) return null;
    const item = parseMenuItem(candidate, depth, state);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function parseMenuItem(value: unknown, depth: number, state: { count: number }): MenuItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    !isInteger(item.id) ||
    !isBoundedString(item.name, MAX_LABEL_LENGTH) ||
    !isInteger(item.displayOrder) ||
    !isInteger(item.mobileDisplayOrder) ||
    !isOptionalInteger(item.parentId, true) ||
    !isOptionalInteger(item.menuType) ||
    !isOptionalInteger(item.itemType) ||
    !isOptionalInteger(item.menuDisplayDeviceType) ||
    !isOptionalInteger(item.menuDisplayType) ||
    !isOptionalString(item.hamburgerName, MAX_LABEL_LENGTH) ||
    !isOptionalString(item.description, MAX_DESCRIPTION_LENGTH) ||
    (item.external !== undefined && typeof item.external !== "boolean")
  ) {
    return null;
  }

  const external = item.external === true;
  if (typeof item.url !== "string") return null;
  const url = normalizeNavigationUrl(item.url, { siteUrl: config.siteUrl, external });
  if (!url) return null;

  const imagePath = parseOptionalImageUrl(item.imagePath);
  const activeImagePath = parseOptionalImageUrl(item.activeImagePath);
  if (imagePath === null || activeImagePath === null) return null;

  const children = parseMenuList(item.subMenuItemList, depth + 1, state);
  if (children === null) return null;

  return {
    id: item.id,
    name: item.name,
    url,
    displayOrder: item.displayOrder,
    mobileDisplayOrder: item.mobileDisplayOrder,
    ...(item.parentId !== undefined ? { parentId: item.parentId as number | null } : {}),
    ...(item.hamburgerName !== undefined ? { hamburgerName: item.hamburgerName as string } : {}),
    ...(item.description !== undefined ? { description: item.description as string } : {}),
    ...(imagePath !== undefined ? { imagePath } : {}),
    ...(activeImagePath !== undefined ? { activeImagePath } : {}),
    ...(item.external !== undefined ? { external } : {}),
    ...(item.menuType !== undefined ? { menuType: item.menuType as number } : {}),
    ...(item.itemType !== undefined ? { itemType: item.itemType as number } : {}),
    ...(item.menuDisplayDeviceType !== undefined
      ? { menuDisplayDeviceType: item.menuDisplayDeviceType as number }
      : {}),
    ...(item.menuDisplayType !== undefined
      ? { menuDisplayType: item.menuDisplayType as number }
      : {}),
    ...(children?.length ? { subMenuItemList: children } : {}),
  };
}

function parseOptionalImageUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return normalizeMetadataImageUrl(value, config.siteUrl);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isOptionalInteger(value: unknown, nullable = false): boolean {
  return value === undefined || (nullable && value === null) || isInteger(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isOptionalString(value: unknown, max: number): boolean {
  return value === undefined || isBoundedString(value, max);
}
