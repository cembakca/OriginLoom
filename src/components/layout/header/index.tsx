import type { CSSProperties } from "react";
import type { DeviceShell, DeviceType } from "../../../lib/device";
import { getDeviceShell } from "../../../lib/device";
import type { IMenuItems } from "../../../lib/menu/types";
import { sortNavItems, topNavItems } from "../../../lib/menu/utils";
import { NavBar, UserChromeSlot } from "./nav-parts";

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  padding: "0.75rem 1rem",
  borderBottom: "1px solid #e2e8f0",
};

function DesktopHeader({ menu, shell }: { menu: IMenuItems; shell: DeviceShell }) {
  const items = sortNavItems(topNavItems(menu.headerItems), shell);
  return (
    <header style={headerStyle} data-shell="desktop">
      <a href="/" style={{ fontWeight: 700 }}>
        Hangikredi
      </a>
      <NavBar items={items} shell={shell} />
      <UserChromeSlot />
    </header>
  );
}

function MobileHeader({ menu, shell }: { menu: IMenuItems; shell: DeviceShell }) {
  const items = sortNavItems(topNavItems(menu.headerItems), shell);
  return (
    <header style={headerStyle} data-shell="mobile">
      <span style={{ fontSize: "0.875rem", color: "#64748b" }}>Menü</span>
      <a href="/" style={{ fontWeight: 700 }}>
        Hangikredi
      </a>
      <UserChromeSlot />
      <div id="mobile-nav-panel" style={{ width: "100%" }}>
        {/* SSR: aynı nav ağacı accordion — island hamburger toggle ileride eklenebilir */}
        <details open style={{ marginTop: "0.5rem" }}>
          <summary style={{ cursor: "pointer" }}>Navigasyon</summary>
          <nav aria-label="Mobil menü">
            <ul style={{ listStyle: "none", margin: "0.5rem 0 0", padding: 0 }}>
              {items.map((item) => (
                <li key={item.id} style={{ margin: "0.35rem 0" }}>
                  <a href={item.url}>{item.hamburgerName ?? item.name}</a>
                  {item.subMenuItemList?.map((sub) => (
                    <a
                      key={sub.id}
                      href={sub.url}
                      style={{ display: "block", marginLeft: "1rem", fontSize: "0.875rem" }}
                    >
                      {sub.hamburgerName ?? sub.name}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}

export function Header({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const shell = getDeviceShell(deviceType);
  return shell === "desktop" ? (
    <DesktopHeader menu={menu} shell={shell} />
  ) : (
    <MobileHeader menu={menu} shell={shell} />
  );
}
