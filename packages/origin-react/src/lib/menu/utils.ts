import type { DeviceShell } from "../device.js";
import { type MenuItem, MenuItemType } from "./types.js";

export function navLabel(item: MenuItem, shell: DeviceShell): string {
  return shell === "mobile" && item.hamburgerName ? item.hamburgerName : item.name;
}

export function sortNavItems(items: MenuItem[], shell: DeviceShell): MenuItem[] {
  const key = shell === "desktop" ? "displayOrder" : "mobileDisplayOrder";
  return [...items]
    .sort((a, b) => a[key] - b[key])
    .map(({ subMenuItemList, ...item }) => {
      const children = subMenuItemList?.length ? sortNavItems(subMenuItemList, shell) : undefined;
      return children ? { ...item, subMenuItemList: children } : item;
    });
}

export function topNavItems(items: MenuItem[]): MenuItem[] {
  return items.filter(
    (item) =>
      item.itemType === MenuItemType.Header ||
      item.itemType === MenuItemType.Hamburger ||
      !item.parentId,
  );
}

export function footerNavItems(items: MenuItem[]): MenuItem[] {
  return items.filter(
    (item) => item.itemType === MenuItemType.Footer || item.itemType === undefined,
  );
}

export function sortFooterItems(items: MenuItem[], shell: DeviceShell): MenuItem[] {
  const key = shell === "desktop" ? "displayOrder" : "mobileDisplayOrder";
  return [...items]
    .sort((a, b) => a[key] - b[key])
    .map(({ subMenuItemList, ...item }) => {
      const children = subMenuItemList?.length
        ? sortFooterItems(subMenuItemList, shell)
        : undefined;
      return children ? { ...item, subMenuItemList: children } : item;
    });
}

export function linkRel(url: string): string | undefined {
  return url.endsWith(".pdf") ? "nofollow" : undefined;
}
