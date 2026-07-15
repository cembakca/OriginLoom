import type { DeviceType } from "../../../lib/device";
import { getDeviceShell } from "../../../lib/device";
import type { IMenuItems } from "../../../lib/menu/types";
import { serializeNavItems } from "../../../lib/menu/serialize";
import { footerNavItems, linkRel, sortFooterItems } from "../../../lib/menu/utils";
import { Container, Logo } from "~/components/ui/container";
import { FooterAccordionSlot, NavLink } from "../header/nav-parts";

export function Footer({ menu, deviceType }: { menu: IMenuItems; deviceType: DeviceType }) {
  const shell = getDeviceShell(deviceType);
  const items = sortFooterItems(footerNavItems(menu.footerItems), shell);
  const serialized = serializeNavItems(items);
  const isMobile = shell === "mobile";

  return (
    <footer className="mt-auto border-t border-slate-200 bg-white" data-shell={shell}>
      <Container className="py-10">
        <Logo className="mb-6" />

        {isMobile ? (
          <FooterAccordionSlot items={serialized} />
        ) : (
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {items.map((col) => (
              <div key={col.id}>
                <h3 className="mb-3 text-sm font-semibold text-slate-900">{col.name}</h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  {col.subMenuItemList?.map((link) => (
                    <li key={link.id}>
                      <NavLink href={link.url} rel={linkRel(link.url)}>
                        {link.name}
                      </NavLink>
                    </li>
                  )) ?? (
                    <li>
                      <NavLink href={col.url} rel={linkRel(col.url)}>
                        {col.name}
                      </NavLink>
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
