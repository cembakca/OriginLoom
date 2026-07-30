import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountSeoRoutes as mountPlatformSeoRoutes, type SitemapEntry } from "@originloom/core/seo";
import { fetchSitemapEntries } from "@server/services/sitemap";
import type { Hono } from "hono";

export { robotsText, sitemapXml } from "@originloom/core/seo";

/** Served when the gateway cannot answer — a stale sitemap beats no sitemap. */
const FALLBACK_SITEMAP_PATHS: SitemapEntry[] = [
  { path: "/" },
  { path: "/bilgi-merkezi" },
  { path: "/konut-kredisi" },
  { path: "/kredi-kartlari" },
  { path: "/piyasalar/bist-100" },
  { path: "/uzaktan-musteri-edinimi" },
];

export function mountSeoRoutes(app: Hono<{ Variables: AppVariables }>, siteUrl: string): void {
  mountPlatformSeoRoutes(app, {
    siteUrl,
    entries: (request) => fetchSitemapEntries(request),
    fallbackEntries: FALLBACK_SITEMAP_PATHS,
  });
}
