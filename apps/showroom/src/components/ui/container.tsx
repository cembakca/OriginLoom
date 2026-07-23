import { cn } from "@originloom/react/lib/utils";
import type { HTMLAttributes } from "react";

import { BrandMark } from "~/components/icons";

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)} {...props} />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <a
      href="/"
      className={cn("inline-flex items-center gap-2 font-bold text-brand-700", className)}
    >
      <BrandMark className="h-8 w-8 shrink-0 text-brand-600" aria-hidden />
      <span className="hidden sm:inline">Hangikredi</span>
    </a>
  );
}
