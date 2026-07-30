import { Link } from "@originloom/react/lib/link";
import type { NavItemProp } from "@originloom/shared/lib/menu/serialize";
import { linkRel } from "@originloom/shared/lib/menu/utils";

import {
  AccordionContent,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
} from "~/components/ui/accordion";

type Props = { items: NavItemProp[] };

/** Mobile footer kolonları — Radix Accordion. */
export default function FooterAccordion({ items }: Props) {
  return (
    <AccordionRoot type="multiple" className="w-full">
      {items.map((col) => (
        <AccordionItem key={col.id} value={String(col.id)}>
          <AccordionTrigger>{col.name}</AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-2">
              {col.children?.map((link) => (
                <li key={link.id}>
                  <Link href={link.url} rel={linkRel(link.url)} className="hover:text-brand-600">
                    {link.name}
                  </Link>
                </li>
              )) ?? (
                <li>
                  <Link href={col.url} rel={linkRel(col.url)} className="hover:text-brand-600">
                    {col.name}
                  </Link>
                </li>
              )}
            </ul>
          </AccordionContent>
        </AccordionItem>
      ))}
    </AccordionRoot>
  );
}
