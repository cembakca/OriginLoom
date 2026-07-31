import { gatewayFetchWithIdentity, requireGatewayOk } from "@originloom/core/adapters/gateway";
import * as cache from "@originloom/core/cache";
import { config } from "@originloom/core/config";
import { parseGatewayPayload, readGatewayJson } from "@originloom/core/gateway-payload";
import { memoizeRequestValue } from "@originloom/core/observability";
import {
  normalizeMetadataImageUrl,
  normalizeNavigationUrl,
} from "@originloom/shared/lib/content-url";
import type { DeviceType } from "@originloom/shared/lib/device";
import type { IMenuItems, MenuItem } from "@originloom/shared/lib/menu/types";
import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import { productConfig } from "@server/product/config";
import { GatewayContracts } from "@server/services/gateway-contracts";

import { menuCacheKey } from "~/lib/cache-keys";

const MAX_MENU_DEPTH = 3;
const MAX_MENU_ITEMS = 200;
const MAX_ITEMS_PER_LEVEL = 50;
const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const INVALID_MENU = "Menu gateway returned an invalid payload";
const parsedSnapshots = new Map<DeviceType, { body: string; menu: IMenuItems }>();

/** Public menu endpoint — device header ile tek fetch; uzun TTL API cache. */
export function fetchMenuList(request: Request, device: DeviceType): Promise<IMenuItems> {
  return memoizeRequestValue(`gateway:menu:${device}`, () => loadMenuList(request, device));
}

async function loadMenuList(request: Request, device: DeviceType): Promise<IMenuItems> {
  const key = menuCacheKey(device);
  const policy = {
    kind: "shared" as const,
    ttl: productConfig.menuCacheTtl,
    swr: productConfig.menuCacheSwr,
    key: [key],
  };
  const cacheKey = cache.cacheKey(policy);

  if (cacheKey) {
    const hit = await cache.read(cacheKey);
    if (hit) {
      const snapshot = parsedSnapshots.get(device);
      if (snapshot?.body === hit.body) return snapshot.menu;
      try {
        const cached: unknown = JSON.parse(hit.body);
        const menu = parseMenuPayload(cached);
        if (menu) {
          const immutable = freezeMenu(menu);
          parsedSnapshots.set(device, { body: hit.body, menu: immutable });
          return immutable;
        }
      } catch {
        // Corrupt/old entries are treated as a miss and replaced below.
      }
      await cache.deleteKey(cacheKey);
    }
  }

  const data = freezeMenu(await fetchMenuFromGateway(request, device));

  if (cacheKey) {
    const body = JSON.stringify(data);
    await cache.write(cacheKey, body, policy);
    parsedSnapshots.set(device, { body, menu: data });
  }

  return data;
}

function freezeMenu(menu: IMenuItems): IMenuItems {
  const freezeItems = (items: MenuItem[]): MenuItem[] => {
    for (const item of items) {
      if (item.subMenuItemList) freezeItems(item.subMenuItemList);
      Object.freeze(item);
    }
    return Object.freeze(items) as MenuItem[];
  };
  freezeItems(menu.headerItems);
  freezeItems(menu.hamburgerItems);
  freezeItems(menu.footerItems);
  return Object.freeze(menu);
}

async function fetchMenuFromGateway(request: Request, device: DeviceType): Promise<IMenuItems> {
  // The menu is cached under a device key and shared by every visitor, so this
  // call must not carry the caller's credentials — only the identity the gateway
  // wants for telemetry.
  const res = await gatewayFetchWithIdentity(request, "/pages/menuitem/list", {
    headers: {
      "content-type": "application/json",
      device,
      CorrelationId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
  });

  await requireGatewayOk(res, "Menu gateway returned");

  const data = await readGatewayJson(res, GatewayContracts.menu, INVALID_MENU);
  return parseGatewayPayload(GatewayContracts.menu, data, parseMenuPayload, INVALID_MENU);
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
  if (!hasValidMenuFields(item)) return null;

  const external = item.external === true;
  if (typeof item.url !== "string") return null;
  const url = normalizeNavigationUrl(item.url, { siteUrl: config.siteUrl, external });
  if (!url) return null;

  // undefined means "absent"; null means "present and unusable", which fails the item.
  const imagePath = parseOptionalImageUrl(item.imagePath);
  const activeImagePath = parseOptionalImageUrl(item.activeImagePath);
  if (imagePath === null || activeImagePath === null) return null;

  const children = parseMenuList(item.subMenuItemList, depth + 1, state);
  if (children === null) return null;

  return {
    id: item.id as number,
    name: item.name as string,
    url,
    displayOrder: item.displayOrder as number,
    mobileDisplayOrder: item.mobileDisplayOrder as number,
    // Absent stays absent: an explicit `undefined` key is not the same shape as no
    // key at all under exactOptionalPropertyTypes. parentId survives as null.
    ...stripUndefined({
      parentId: item.parentId as number | null | undefined,
      hamburgerName: item.hamburgerName as string | undefined,
      description: item.description as string | undefined,
      imagePath,
      activeImagePath,
      external: item.external === undefined ? undefined : external,
      menuType: item.menuType as number | undefined,
      itemType: item.itemType as number | undefined,
      menuDisplayDeviceType: item.menuDisplayDeviceType as number | undefined,
      menuDisplayType: item.menuDisplayType as number | undefined,
      subMenuItemList: children?.length ? children : undefined,
    }),
  };
}

/** Everything the upstream must get right before the item is worth shaping. */
function hasValidMenuFields(item: Record<string, unknown>): boolean {
  return (
    isInteger(item.id) &&
    isBoundedString(item.name, MAX_LABEL_LENGTH) &&
    isInteger(item.displayOrder) &&
    isInteger(item.mobileDisplayOrder) &&
    isOptionalInteger(item.parentId, true) &&
    isOptionalInteger(item.menuType) &&
    isOptionalInteger(item.itemType) &&
    isOptionalInteger(item.menuDisplayDeviceType) &&
    isOptionalInteger(item.menuDisplayType) &&
    isOptionalString(item.hamburgerName, MAX_LABEL_LENGTH) &&
    isOptionalString(item.description, MAX_DESCRIPTION_LENGTH) &&
    (item.external === undefined || typeof item.external === "boolean")
  );
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
