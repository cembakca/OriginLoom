import { logger } from "@server/logger";
import { contextRequest, isRequestDeadlineError } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { fetchRouteDomains } from "@server/services/route-domains";
import type { Hono } from "hono";

const STATIC_SITEMAP_PATHS = [
  "/",
  "/blogs/paginated",
  "/bilgi-merkezi",
  "/emekli-bankaciligi",
  "/ihtiyac-kredisi",
  "/konut-kredisi",
  "/kredi-kartlari",
  "/medya-pipeline",
  "/piyasalar/bist-100",
  "/uzaktan-musteri-edinimi",
] as const;

export function mountSeoRoutes(app: Hono<{ Variables: AppVariables }>, siteUrl: string): void {
  app.on(["GET", "HEAD"], "/robots.txt", (c) =>
    textResponse(c.req.method, robotsText(siteUrl), "text/plain; charset=utf-8"),
  );
  app.on(["GET", "HEAD"], "/sitemap.xml", async (c) => {
    const request = contextRequest(c);
    let loanCities: string[] = [];
    try {
      loanCities = (await fetchRouteDomains(request.signal)).loanCities;
    } catch (error) {
      if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
      if (isRequestDeadlineError(error)) throw error;
      logger.warn("sitemap route domains degraded", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return textResponse(
      c.req.method,
      sitemapXml(siteUrl, loanCities),
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

export function sitemapXml(siteUrl: string, loanCities: string[]): string {
  const paths = new Set<string>(STATIC_SITEMAP_PATHS);
  for (const city of loanCities) paths.add(`/ihtiyac-kredisi/${encodeURIComponent(city)}`);
  const entries = [...paths]
    .sort()
    .map((path) => `  <url><loc>${escapeXml(new URL(path, siteUrl).toString())}</loc></url>`)
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
