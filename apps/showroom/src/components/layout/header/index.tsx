import type { DeviceType } from "@originloom/shared/lib/device";
import { getDeviceShell } from "@originloom/shared/lib/device";
import { serializeNavItems } from "@originloom/shared/lib/menu/serialize";
import type { IMenuItems } from "@originloom/shared/lib/menu/types";
import { sortNavItems, topNavItems } from "@originloom/shared/lib/menu/utils";

import { Container, Logo } from "~/components/ui/container";

import { DesktopNavBar, MobileMenuSlot, UserChromeSlot } from "./nav-parts";

type HeaderView = {
  shell: "desktop" | "mobile";
  items: ReturnType<typeof sortNavItems>;
  serialized: ReturnType<typeof serializeNavItems>;
};

const headerViews = new WeakMap<IMenuItems, Map<DeviceType, HeaderView>>();

function DesktopHeader({ view }: { view: HeaderView }) {
  return (
    <header
      className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur"
      data-shell="desktop"
    >
      <Container className="flex h-16 items-center gap-4">
        <Logo className="shrink-0" />
        <DesktopNavBar items={view.items} shell={view.shell} />
        <div className="ml-auto shrink-0">
          <UserChromeSlot />
        </div>
      </Container>
    </header>
  );
}

function MobileHeader({ view }: { view: HeaderView }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white" data-shell="mobile">
      <Container className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <MobileMenuSlot items={view.serialized} />
        <Logo />
        <div className="justify-self-end">
          <UserChromeSlot />
        </div>
      </Container>
    </header>
  );
}

export function Header({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const view = headerView(menu, deviceType);
  return view.shell === "desktop" ? <DesktopHeader view={view} /> : <MobileHeader view={view} />;
}

function headerView(menu: IMenuItems, deviceType: DeviceType): HeaderView {
  let byDevice = headerViews.get(menu);
  if (!byDevice) {
    byDevice = new Map();
    headerViews.set(menu, byDevice);
  }
  const cached = byDevice.get(deviceType);
  if (cached) return cached;
  const shell = getDeviceShell(deviceType);
  const items = sortNavItems(topNavItems(menu.headerItems), shell);
  const view = { shell, items, serialized: serializeNavItems(items) };
  byDevice.set(deviceType, view);
  return view;
}
