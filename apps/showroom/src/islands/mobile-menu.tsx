import type { NavItemProp } from "@originloom/shared/lib/menu/serialize";

import { Menu } from "~/components/icons";
import {
  AccordionContent,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "~/components/ui/sheet";

type Props = { items: NavItemProp[] };

/** Mobile hamburger — Radix Sheet + Accordion; SSR fallback: ☰ button. */
export default function MobileMenu({ items }: Props) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Menüyü aç">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Menü</SheetTitle>
        </SheetHeader>

        <AccordionRoot type="multiple" className="mt-2">
          {items.map((item) =>
            item.children?.length ? (
              <AccordionItem key={item.id} value={String(item.id)}>
                <AccordionTrigger>{item.hamburgerName ?? item.name}</AccordionTrigger>
                <AccordionContent>
                  <ul className="space-y-2">
                    <li>
                      <a href={item.url} className="font-medium text-brand-600 hover:underline">
                        Tümünü gör
                      </a>
                    </li>
                    {item.children.map((sub) =>
                      sub.menuDisplayType === 1 ? (
                        <li
                          key={sub.id}
                          className="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm"
                        >
                          <p className="font-semibold text-brand-800">
                            {sub.hamburgerName ?? sub.name}
                          </p>
                          {sub.description ? (
                            <p className="mt-1 text-slate-600">{sub.description}</p>
                          ) : null}
                          {sub.url ? (
                            <a
                              href={sub.url}
                              className="mt-2 inline-block text-brand-600 hover:underline"
                            >
                              Devam
                            </a>
                          ) : null}
                        </li>
                      ) : (
                        <li key={sub.id}>
                          <a href={sub.url} className="text-slate-700 hover:text-brand-600">
                            {sub.hamburgerName ?? sub.name}
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ) : (
              <a
                key={item.id}
                href={item.url}
                className="block border-b border-slate-200 py-4 text-sm font-semibold hover:text-brand-600"
              >
                {item.hamburgerName ?? item.name}
              </a>
            ),
          )}
        </AccordionRoot>

        <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 text-sm">
          <a href="/hesabim" className="block font-medium text-slate-800 hover:text-brand-600">
            Hesabım
          </a>
          <a href="/giris" className="block text-brand-600 hover:underline">
            Giriş yap
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
