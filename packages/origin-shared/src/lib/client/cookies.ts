import { Cookie, cookieNameCandidates } from "../cookies.js";

/**
 * Client-side cookie reader — safe inside islands; never embed values in cached
 * HTML.
 *
 * Tries the `__Host-` name first for the cookies the platform prefixes. The
 * browser half of the migration matters as much as the server half: production
 * sets `__Host-signed_in`, and an island that only knew `signed_in` would show
 * every signed-in visitor a signed-out header until their old cookie expired.
 */
export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const candidate of cookieNameCandidates(name)) {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
    );
    if (match) return decodeURIComponent(match[1] ?? "");
  }
  return undefined;
}

/** Optimistic UI hint only; authorization and final session state come from the BFF. */
export function hasAuthCookies(): boolean {
  return readCookie(Cookie.signedIn) === "1";
}
