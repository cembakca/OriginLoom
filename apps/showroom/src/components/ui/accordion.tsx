import { cn } from "@originloom/react/lib/utils";
import * as Accordion from "@radix-ui/react-accordion";
import type { ComponentPropsWithRef } from "react";

import { ChevronDown } from "~/components/icons";

export const AccordionRoot = Accordion.Root;

export function AccordionItem({
  className,
  ...props
}: ComponentPropsWithRef<typeof Accordion.Item>) {
  return <Accordion.Item className={cn("border-b border-slate-200", className)} {...props} />;
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof Accordion.Trigger>) {
  return (
    <Accordion.Header className="flex">
      <Accordion.Trigger
        className={cn(
          "flex flex-1 items-center justify-between py-4 text-left text-sm font-semibold transition-all hover:text-brand-600 [&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200" />
      </Accordion.Trigger>
    </Accordion.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof Accordion.Content>) {
  return (
    <Accordion.Content
      className="overflow-hidden text-sm data-[state=closed]:hidden data-[state=open]:block"
      {...props}
    >
      <div className={cn("pb-4 pt-0 text-slate-600", className)}>{children}</div>
    </Accordion.Content>
  );
}
