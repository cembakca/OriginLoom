import { cookieNameCandidates } from "./cookies.js";

/** Read one cookie off a standard Request. That is all this does. */
export function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Collapse the User-Agent into a small closed set so the cache key stays small. */
export { device } from "./device.js";

export function locale(request: Request): string {
  const al = request.headers.get("accept-language") ?? "";
  const first = al.split(",")[0]?.slice(0, 2).toLowerCase();
  return first === "en" ? "en" : "tr";
}

/**
 * Reads a cookie the platform may have written under a `__Host-` prefix.
 *
 * Callers keep using the plain name; which name is actually on the wire is the
 * cookie layer's business, and during the migration it is both.
 */
export function sessionCookie(request: Request, name: string): string | undefined {
  for (const candidate of cookieNameCandidates(name)) {
    const value = cookie(request, candidate);
    if (value !== undefined) return value;
  }
  return undefined;
}
