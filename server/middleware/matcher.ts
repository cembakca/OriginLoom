/**
 * Level-2 matcher — should the auth/session/redirect pipeline run?
 * Level-1 exclusions (assets, health) are handled in server/index.ts mounts.
 */
export function shouldRunPipeline(pathname: string): boolean {
  if (pathname.startsWith("/assets/")) return false;
  if (pathname === "/healthz" || pathname === "/readyz" || pathname === "/favicon.ico")
    return false;
  if (/\.(js|css|map|ico|png|jpe?g|webp|svg|woff2?)$/i.test(pathname)) return false;
  if (pathname.includes("_next")) return false;

  // Internal BFF — pipeline runs (auth refresh)
  if (pathname.startsWith("/api/internal/")) return true;

  // Public / proxied API — skip pipeline
  if (pathname.startsWith("/api/")) return false;

  return true;
}
