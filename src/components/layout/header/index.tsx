import type { DeviceType } from "../../../lib/device";
import { getDeviceShell } from "../../../lib/device";
import type { IMenuItems } from "../../../lib/menu/types";
import { serializeNavItems } from "../../../lib/menu/serialize";
import { sortNavItems, topNavItems } from "../../../lib/menu/utils";
import { Container, Logo } from "~/components/ui/container";
import { DesktopNavBar, MobileMenuSlot, UserChromeSlot } from "./nav-parts";

function DesktopHeader({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const shell = getDeviceShell(deviceType);
  const items = sortNavItems(topNavItems(menu.headerItems), shell);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur" data-shell="desktop">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />
        <DesktopNavBar items={items} shell={shell} />
        <div className="flex items-center gap-2">
          <UserChromeSlot />
        </div>
      </Container>
    </header>
  );
}

function MobileHeader({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const shell = getDeviceShell(deviceType);
  const items = sortNavItems(topNavItems(menu.headerItems), shell);
  const serialized = serializeNavItems(items);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white" data-shell="mobile">
      <Container className="flex h-14 items-center justify-between gap-3">
        <MobileMenuSlot items={serialized} />
        <Logo className="absolute left-1/2 -translate-x-1/2" />
        <UserChromeSlot />
      </Container>
    </header>
  );
}

export function Header({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const shell = getDeviceShell(deviceType);
  return shell === "desktop" ? (
    <DesktopHeader menu={menu} deviceType={deviceType} />
  ) : (
    <MobileHeader menu={menu} deviceType={deviceType} />
  );
}
