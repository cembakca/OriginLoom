import { parseCacheKey } from "@server/cache/key-codec";
import { tryGetRuntime } from "@server/runtime";

export function cacheRouteLabel(key: string): string {
  const prefix = parseCacheKey(key)[0] ?? "other";
  if (tryGetRuntime()?.cacheKeys.isKnownPageCachePrefix(prefix)) return prefix;
  if (prefix.startsWith("menu:")) return "menu";
  return "other";
}
