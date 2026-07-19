import { logger } from "@server/logger";
import { contextRequest, isRequestDeadlineError } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { fetchSitemapEntries, type SitemapEntry } from "@server/services/sitemap";
import type { Hono } from "hono";

const FALLBACK_SITEMAP_PATHS = [
  "/",
  "/bilgi-merkezi",
  "/konut-kredisi",
  "/kredi-kartlari",
  "/piyasalar/bist-100",
  "/uzaktan-musteri-edinimi",
] as const;

export function mountSeoRoutes(app: Hono<{ Variables: AppVariables }>, siteUrl: string): void {
  app.on(["GET", "HEAD"], "/robots.txt", (c) =>
    textResponse(c.req.method, robotsText(siteUrl), "text/plain; charset=utf-8"),
  );
  app.on(["GET", "HEAD"], "/sitemap.xml", async (c) => {
    const request = contextRequest(c);
    let entries: SitemapEntry[] = FALLBACK_SITEMAP_PATHS.map((path) => ({ path }));
    try {
      entries = await fetchSitemapEntries(request.signal);
    } catch (error) {
      if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
      if (isRequestDeadlineError(error)) throw error;
      logger.warn("sitemap gateway degraded", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return textResponse(
      c.req.method,
      sitemapXml(siteUrl, entries),
      "application/xml; charset=utf-8",
    );
  });
}

export function robotsText(siteUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    `Sitemap: ${new URL("/sitemap.xml", siteUrl).toString()}`,
    "",
  ].join("\n");
}

export function sitemapXml(siteUrl: string, sitemapEntries: SitemapEntry[]): string {
  const entries = [...sitemapEntries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => {
      const loc = `<loc>${escapeXml(new URL(entry.path, siteUrl).toString())}</loc>`;
      const lastmod = entry.lastModified
        ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>`
        : "";
      return `  <url>${loc}${lastmod}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function textResponse(method: string, body: string, contentType: string): Response {
  return new Response(method === "HEAD" ? null : body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
