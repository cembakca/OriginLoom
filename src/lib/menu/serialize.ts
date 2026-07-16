import { stripUndefined } from "~/lib/strip-undefined";

import type { MenuItem } from "./types";

/** Island props — serializable nav snapshot. */
export type NavItemProp = {
  id: number;
  name: string;
  url: string;
  hamburgerName?: string;
  description?: string;
  external?: boolean;
  menuDisplayType?: number;
  children?: NavItemProp[];
};

export function serializeNavItems(items: MenuItem[]): NavItemProp[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    url: item.url,
    ...stripUndefined({
      hamburgerName: item.hamburgerName,
      description: item.description,
      external: item.external,
      menuDisplayType: item.menuDisplayType,
    }),
    ...(item.subMenuItemList?.length ? { children: serializeNavItems(item.subMenuItemList) } : {}),
  }));
}
