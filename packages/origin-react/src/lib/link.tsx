/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { isCurrentPath, resolveLinkAttributes } from "@originloom/shared/lib/link";
import type { AnchorHTMLAttributes } from "react";

import { useRequestContext } from "./request-context.js";

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  /**
   * Marks the link as pointing at the current page (`aria-current="page"`).
   * Resolved from the request path by default; pass it explicitly for a link
   * that represents a section rather than an exact URL.
   */
  current?: boolean;
};

/**
 * Every link an app renders, in one place.
 *
 * It exists because the rules about a link are not local to the component that
 * writes it: a scheme that must never be followed, a `target="_blank"` that must
 * not hand the opened page a handle on this one, and the page's own address
 * needing to be announced to assistive technology. Applied by hand, each of
 * those is applied almost everywhere.
 *
 * Anything not on this site is passed through untouched apart from `rel`.
 */
export function Link({ href, target, rel, current, children, ...props }: LinkProps) {
  const { publicPath, search, siteUrl } = useRequestContext();
  const resolved =
    href === undefined
      ? { href: undefined, rel, kind: "inert" as const }
      : resolveLinkAttributes(href, { target, rel, siteUrl });

  const isCurrent =
    current ??
    (resolved.kind === "internal" && isCurrentPath(resolved.href ?? "", publicPath, search));

  return (
    <a
      {...(resolved.href === undefined ? {} : { href: resolved.href })}
      {...(target === undefined ? {} : { target })}
      {...(resolved.rel === undefined ? {} : { rel: resolved.rel })}
      {...(isCurrent ? { "aria-current": "page" as const } : {})}
      {...props}
    >
      {children}
    </a>
  );
}
