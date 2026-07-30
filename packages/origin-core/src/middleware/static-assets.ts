import type { Context, Next } from "hono";

import { appendVary } from "./vary.js";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Vite hash'li dosyalar — uzun süre cache (CDN veya origin). */
export async function staticAssetCacheHeaders(c: Context, next: Next): Promise<void> {
  await next();
  if (c.req.path.startsWith("/assets/") && c.res.status === 200) {
    c.header("Cache-Control", IMMUTABLE_CACHE);
    if (c.res.headers.has("Content-Encoding")) {
      c.header("Vary", appendVary(c.res.headers.get("Vary"), "Accept-Encoding"));
    }
  }
}
