import type { Hono } from "hono";

import { logger } from "./logger.js";
import { contextRequest, isRequestDeadlineError } from "./middleware/request-deadline.js";
import type { AppVariables } from "./middleware/request-id.js";

export type SitemapEntry = {
  /** Path on the site, e.g. `/items/alpha`. Resolved against `siteUrl`. */
  path: string;
  /** W3C datetime, e.g. `2026-07-27`. Omit when unknown — a wrong date is worse. */
  lastModified?: string;
};

export type SeoRoutesOptions = {
  siteUrl: string;
  /**
   * The URLs to advertise. Usually a gateway call, so it takes the request's
   * signal and may fail; when it does, `fallbackEntries` are served instead of a
   * 500 — a stale sitemap beats no sitemap.
   */
  entries: (signal: AbortSignal) => Promise<SitemapEntry[]> | SitemapEntry[];
  fallbackEntries?: SitemapEntry[];
  /** Paths kept out of robots.txt. Defaults to the app's API surface. */
  disallow?: readonly string[];
};

/**
 * `robots.txt` and `sitemap.xml`. The mechanics — headers, caching, XML escaping,
 * degradation — are the platform's; which URLs exist is the app's, so it passes
 * them in.
 */
export function mountSeoRoutes(
  app: Hono<{ Variables: AppVariables }>,
  options: SeoRoutesOptions,
): void {
  const { siteUrl, entries, fallbackEntries = [], disallow = ["/api/"] } = options;

  app.on(["GET", "HEAD"], "/robots.txt", (c) =>
    textResponse(c.req.method, robotsText(siteUrl, disallow), "text/plain; charset=utf-8"),
  );

  app.on(["GET", "HEAD"], "/sitemap.xml", async (c) => {
    const request = contextRequest(c);
    let resolved: SitemapEntry[] = fallbackEntries;
    try {
      resolved = await entries(request.signal);
    } catch (error) {
      if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
      if (isRequestDeadlineError(error)) throw error;
      logger.warn("sitemap source degraded", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return textResponse(
      c.req.method,
      sitemapXml(siteUrl, resolved),
      "application/xml; charset=utf-8",
    );
  });
}

export function robotsText(siteUrl: string, disallow: readonly string[] = ["/api/"]): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...disallow.map((path) => `Disallow: ${path}`),
    `Sitemap: ${new URL("/sitemap.xml", siteUrl).toString()}`,
    "",
  ].join("\n");
}

export function sitemapXml(siteUrl: string, sitemapEntries: readonly SitemapEntry[]): string {
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
