import { cn } from "@originloom/react/lib/utils";
import * as Dialog from "@radix-ui/react-dialog";
import type { ComponentPropsWithRef, HTMLAttributes } from "react";

import { X } from "~/components/icons";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
export const SheetPortal = Dialog.Portal;

export function SheetOverlay({
  className,
  ...props
}: ComponentPropsWithRef<typeof Dialog.Overlay>) {
  return (
    <Dialog.Overlay
      className={cn("fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]", className)}
      {...props}
    />
  );
}

export function SheetContent({
  side = "left",
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof Dialog.Content> & { side?: "left" | "right" }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex h-full w-[85vw] max-w-sm flex-col gap-4 border-r border-slate-200 bg-white p-6 shadow-xl transition ease-in-out",
          side === "left" ? "inset-y-0 left-0" : "inset-y-0 right-0 border-l border-r-0",
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-500">
          <X className="h-4 w-4" />
          <span className="sr-only">Kapat</span>
        </Dialog.Close>
      </Dialog.Content>
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <Dialog.Title className={cn("text-lg font-semibold", className)} {...props} />;
}
