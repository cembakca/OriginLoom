import { isKnownPageCachePrefix, parseCacheKey } from "~/lib/cache-keys";

export function cacheRouteLabel(key: string): string {
  const prefix = parseCacheKey(key)[0] ?? "other";
  if (isKnownPageCachePrefix(prefix)) return prefix;
  if (prefix.startsWith("menu:")) return "menu";
  return "other";
}
