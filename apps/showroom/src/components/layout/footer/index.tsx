import type { DeviceType } from "@originloom/shared/lib/device";
import { getDeviceShell } from "@originloom/shared/lib/device";
import { serializeNavItems } from "@originloom/shared/lib/menu/serialize";
import type { IMenuItems } from "@originloom/shared/lib/menu/types";
import { footerNavItems, linkRel, sortFooterItems } from "@originloom/shared/lib/menu/utils";

import { FooterAccordionSlot, NavLink } from "~/components/layout/header/nav-parts";
import { Container, Logo } from "~/components/ui/container";

type FooterView = {
  shell: "desktop" | "mobile";
  items: ReturnType<typeof sortFooterItems>;
  serialized: ReturnType<typeof serializeNavItems>;
};

const footerViews = new WeakMap<IMenuItems, Map<DeviceType, FooterView>>();

export function Footer({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const view = footerView(menu, deviceType);
  const isMobile = view.shell === "mobile";

  return (
    <footer className="mt-auto border-t border-slate-200 bg-white" data-shell={view.shell}>
      <Container className="py-10">
        <Logo className="mb-6" />

        {isMobile ? (
          <FooterAccordionSlot items={view.serialized} />
        ) : (
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {view.items.map((col) => (
              <div key={col.id}>
                <h3 className="mb-3 text-sm font-semibold text-slate-900">{col.name}</h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  {col.subMenuItemList?.map((link) => {
                    const rel = linkRel(link.url);
                    return (
                      <li key={link.id}>
                        <NavLink href={link.url} {...(rel ? { rel } : {})}>
                          {link.name}
                        </NavLink>
                      </li>
                    );
                  }) ?? (
                    <li>
                      {(() => {
                        const rel = linkRel(col.url);
                        return (
                          <NavLink href={col.url} {...(rel ? { rel } : {})}>
                            {col.name}
                          </NavLink>
                        );
                      })()}
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Hangikredi — Bilgilendirme amaçlıdır.
        </p>
      </Container>
    </footer>
  );
}

function footerView(menu: IMenuItems, deviceType: DeviceType): FooterView {
  let byDevice = footerViews.get(menu);
  if (!byDevice) {
    byDevice = new Map();
    footerViews.set(menu, byDevice);
  }
  const cached = byDevice.get(deviceType);
  if (cached) return cached;
  const shell = getDeviceShell(deviceType);
  const items = sortFooterItems(footerNavItems(menu.footerItems), shell);
  const view = { shell, items, serialized: serializeNavItems(items) };
  byDevice.set(deviceType, view);
  return view;
}
