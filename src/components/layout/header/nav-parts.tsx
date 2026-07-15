import { Menu } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import type { DeviceShell } from "~/lib/device";
import { Island } from "~/lib/island";
import type { NavItemProp } from "~/lib/menu/serialize";
import type { MenuItem } from "~/lib/menu/types";
import { navLabel } from "~/lib/menu/utils";
import { cn } from "~/lib/utils";

/** SSR fallback — island ile aynı boyut/stil (CLS önleme). */
export function UserChromeFallback() {
  return (
    <Button variant="secondary" size="sm" asChild className="min-w-[5.5rem]">
      <a href="/giris">Giriş yap</a>
    </Button>
  );
}

export function UserChromeSlot() {
  return (
    <div className="flex h-10 shrink-0 items-center justify-end">
      <Island name="user-chrome" mode="defer">
        <UserChromeFallback />
      </Island>
    </div>
  );
}

export function MobileMenuSlot({ items }: { items: NavItemProp[] }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-self-start">
      <Island name="mobile-menu" mode="defer" props={{ items }}>
        <Button variant="secondary" size="icon" aria-label="Menüyü aç" type="button">
          <Menu className="h-5 w-5" />
        </Button>
      </Island>
    </div>
  );
}

export function DesktopNavBar({ items, shell }: { items: MenuItem[]; shell: DeviceShell }) {
  return (
    <nav aria-label="Ana menü" className="hidden min-h-10 flex-1 items-center gap-1 lg:flex">
      {items.map((item) => (
        <div key={item.id} className="group relative">
          <a
            href={item.url}
            className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-brand-700"
          >
            {navLabel(item, shell)}
          </a>
          {item.subMenuItemList?.length ? (
            <div className="invisible absolute left-0 top-full z-40 min-w-[220px] translate-y-1 rounded-lg border border-slate-200 bg-white p-2 opacity-0 shadow-lg transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
              {item.subMenuItemList.map((sub) => (
                <a
                  key={sub.id}
                  href={sub.url}
                  className="block rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                >
                  {navLabel(sub, shell)}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

export function MobileNavFallback({ items }: { items: NavItemProp[] }) {
  return (
    <nav
      aria-label="Mobil menü"
      className="mt-3 space-y-1 border-t border-slate-200 pt-3 lg:hidden"
    >
      {items.map((item) => (
        <div key={item.id}>
          <a
            href={item.url}
            className="block rounded-md px-2 py-2 text-sm font-medium text-slate-800"
          >
            {item.hamburgerName ?? item.name}
          </a>
          {item.children?.map((sub) => (
            <a
              key={sub.id}
              href={sub.url}
              className="block rounded-md py-1.5 pl-4 text-sm text-slate-600 hover:text-brand-700"
            >
              {sub.hamburgerName ?? sub.name}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function FooterAccordionSlot({ items }: { items: NavItemProp[] }) {
  return (
    <Island name="footer-accordion" mode="defer" props={{ items }}>
      <div className="space-y-2">
        {items.map((col) => (
          <details key={col.id} className="border-b border-slate-200 py-2">
            <summary className="cursor-pointer text-sm font-semibold">{col.name}</summary>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {col.children?.map((link) => (
                <li key={link.id}>
                  <a href={link.url}>{link.name}</a>
                </li>
              )) ?? (
                <li>
                  <a href={col.url}>{col.name}</a>
                </li>
              )}
            </ul>
          </details>
        ))}
      </div>
    </Island>
  );
}

export function NavLink({
  href,
  children,
  className,
  rel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  rel?: string;
}) {
  return (
    <a
      href={href}
      {...(rel !== undefined ? { rel } : {})}
      className={cn("hover:text-brand-600", className)}
    >
      {children}
    </a>
  );
}
