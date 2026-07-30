import { config } from "@originloom/core/config";
import { defineMiddleware } from "@originloom/core/middleware";

const NOINDEX = "noindex, nofollow";

/**
 * Keep non-production deployments out of search results.
 *
 * `robots.txt` cannot do this job alone: it asks crawlers not to fetch a page,
 * not to drop one they already know. `X-Robots-Tag` travels with every document
 * response, including the ones a crawler reached from an external link, and it
 * is a response header rather than markup, so a cached HTML body stays correct
 * for every environment that serves it.
 */
export const searchIndexingMiddleware = defineMiddleware({
  name: "search-indexing",
  handler: () => {
    if (config.appEnv === "production") return;
    return { responseHeaders: { "x-robots-tag": NOINDEX } };
  },
});
