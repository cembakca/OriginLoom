import { Cookie } from "~/lib/cookies";

/** Client-side cookie reader — safe inside islands; never embed values in cached HTML. */
export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

/** Optimistic UI hint only; authorization and final session state come from the BFF. */
export function hasAuthCookies(): boolean {
  return readCookie(Cookie.signedIn) === "1";
}
