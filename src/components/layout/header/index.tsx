import type { DeviceType } from "@originloom/react/lib/device";
import { getDeviceShell } from "@originloom/react/lib/device";
import { serializeNavItems } from "@originloom/react/lib/menu/serialize";
import type { IMenuItems } from "@originloom/react/lib/menu/types";
import { sortNavItems, topNavItems } from "@originloom/react/lib/menu/utils";

import { Container, Logo } from "~/components/ui/container";

import { DesktopNavBar, MobileMenuSlot, UserChromeSlot } from "./nav-parts";

function DesktopHeader({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const shell = getDeviceShell(deviceType);
  const items = sortNavItems(topNavItems(menu.headerItems), shell);

  return (
    <header
      className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur"
      data-shell="desktop"
    >
      <Container className="flex h-16 items-center gap-4">
        <Logo className="shrink-0" />
        <DesktopNavBar items={items} shell={shell} />
        <div className="ml-auto shrink-0">
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
      <Container className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <MobileMenuSlot items={serialized} />
        <Logo />
        <div className="justify-self-end">
          <UserChromeSlot />
        </div>
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
