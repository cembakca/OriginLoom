export const MenuItemType = {
  Header: 4,
  Hamburger: 8,
  Footer: 16,
} as const;

export type MenuItem = {
  id: number;
  parentId?: number | null;
  name: string;
  hamburgerName?: string;
  description?: string;
  url: string;
  imagePath?: string;
  activeImagePath?: string;
  displayOrder: number;
  mobileDisplayOrder: number;
  menuType?: number;
  itemType?: number;
  menuDisplayDeviceType?: number;
  menuDisplayType?: number;
  subMenuItemList?: MenuItem[];
};

export type IMenuItems = {
  headerItems: MenuItem[];
  hamburgerItems: MenuItem[];
  footerItems: MenuItem[];
};
