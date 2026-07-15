/** Read one cookie off a standard Request. That is all this does. */
export function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Collapse the User-Agent into a small closed set so the cache key stays small. */
export function device(request: Request): "mobile" | "desktop" {
  const ua = request.headers.get("user-agent") ?? "";
  return /Android|iPhone|iPad|Mobile/i.test(ua) ? "mobile" : "desktop";
}

export function locale(request: Request): string {
  const al = request.headers.get("accept-language") ?? "";
  const first = al.split(",")[0]?.slice(0, 2).toLowerCase();
  return first === "en" ? "en" : "tr";
}
