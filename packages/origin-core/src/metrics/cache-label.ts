import { parseCacheKey } from "../cache/key-codec.js";
import { tryGetRuntime } from "../runtime.js";

export function cacheRouteLabel(key: string): string {
  const prefix = parseCacheKey(key)[0] ?? "other";
  if (tryGetRuntime()?.cacheKeys.isKnownPageCachePrefix(prefix)) return prefix;
  if (prefix.startsWith("menu:")) return "menu";
  return "other";
}
