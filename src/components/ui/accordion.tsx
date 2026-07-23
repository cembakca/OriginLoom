import * as Accordion from "@radix-ui/react-accordion";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { ChevronDown } from "~/components/icons";
import { cn } from "@originloom/react/lib/utils";

export const AccordionRoot = Accordion.Root;

export const AccordionItem = forwardRef<
  ElementRef<typeof Accordion.Item>,
  ComponentPropsWithoutRef<typeof Accordion.Item>
>(({ className, ...props }, ref) => (
  <Accordion.Item ref={ref} className={cn("border-b border-slate-200", className)} {...props} />
));
AccordionItem.displayName = "AccordionItem";

export const AccordionTrigger = forwardRef<
  ElementRef<typeof Accordion.Trigger>,
  ComponentPropsWithoutRef<typeof Accordion.Trigger>
>(({ className, children, ...props }, ref) => (
  <Accordion.Header className="flex">
    <Accordion.Trigger
      ref={ref}
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
));
AccordionTrigger.displayName = "AccordionTrigger";

export const AccordionContent = forwardRef<
  ElementRef<typeof Accordion.Content>,
  ComponentPropsWithoutRef<typeof Accordion.Content>
>(({ className, children, ...props }, ref) => (
  <Accordion.Content
    ref={ref}
    className="overflow-hidden text-sm data-[state=closed]:hidden data-[state=open]:block"
    {...props}
  >
    <div className={cn("pb-4 pt-0 text-slate-600", className)}>{children}</div>
  </Accordion.Content>
));
AccordionContent.displayName = "AccordionContent";
