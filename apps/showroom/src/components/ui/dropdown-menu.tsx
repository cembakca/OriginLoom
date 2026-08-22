import { Link } from "@originloom/react/lib/link";
import { cn } from "@originloom/react/lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithRef, HTMLAttributes } from "react";

export const DropdownMenuRoot = DropdownMenu.Root;
export const DropdownMenuTrigger = DropdownMenu.Trigger;
export const DropdownMenuGroup = DropdownMenu.Group;
export const DropdownMenuPortal = DropdownMenu.Portal;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentPropsWithRef<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[10rem] overflow-hidden rounded-md border border-slate-200 bg-white p-1 text-slate-900 shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentPropsWithRef<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentPropsWithRef<typeof DropdownMenu.Label> & { inset?: boolean }) {
  return (
    <DropdownMenu.Label
      className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithRef<typeof DropdownMenu.Separator>) {
  return (
    <DropdownMenu.Separator className={cn("-mx-1 my-1 h-px bg-slate-200", className)} {...props} />
  );
}

export function DropdownMenuLinkItem({
  href,
  children,
  className,
}: HTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <DropdownMenu.Item asChild>
      <Link href={href} className={cn("block w-full", className)}>
        {children}
      </Link>
    </DropdownMenu.Item>
  );
}
