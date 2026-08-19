import type { Context, Next } from "hono";

import { appendVary } from "./vary.js";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const PUBLIC_STATIC_CACHE = "public, max-age=3600";

/** Vite hash'li dosyalar — uzun süre cache (CDN veya origin). */
export async function staticAssetCacheHeaders(c: Context, next: Next): Promise<void> {
  await next();
  if (c.res.status !== 200) return;
  if (c.req.path.startsWith("/assets/")) {
    c.header("Cache-Control", IMMUTABLE_CACHE);
  } else if (c.req.path.startsWith("/public/")) {
    c.header("Cache-Control", PUBLIC_STATIC_CACHE);
  } else {
    return;
  }
  if (c.res.headers.has("Content-Encoding")) {
    c.header("Vary", appendVary(c.res.headers.get("Vary"), "Accept-Encoding"));
  }
}
