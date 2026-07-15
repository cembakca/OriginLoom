import type { HTMLAttributes } from "react";

import { cn } from "~/lib/utils";

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)} {...props} />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <a
      href="/"
      className={cn("inline-flex items-center gap-2 font-bold text-brand-700", className)}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">
        HK
      </span>
      <span className="hidden sm:inline">Hangikredi</span>
    </a>
  );
}
