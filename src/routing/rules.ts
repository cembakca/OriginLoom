import type { RedirectRule, RewriteRule } from "./types";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8080";

/**
 * Next.js `rewrites()` equivalent. First match wins.
 *
 * - Internal destination → rewrite (browser URL unchanged, route matcher sees destination)
 * - External destination (http…) → proxy (forward request to backend/CDN)
 */
export const rewrites: RewriteRule[] = [
  {
    source: "/api/:path*",
    destination: `${GATEWAY_URL}/:path*`,
  },
  {
    source: "/dob/assets/:path*",
    destination: "/assets/:path*",
  },
  {
    source: "/emekli-bankaciligi",
    destination: "/retirement-banking",
  },
  {
    source: "/uzaktan-musteri-edinimi",
    destination: "/remote-customer-obtain",
  },
  {
    source: "/basvuru/:page/yonlendirme",
    destination: "/recourse/:page/redirect",
  },
];

/**
 * Next.js `redirects()` equivalent. First match wins.
 * Runs BEFORE rewrites.
 */
export const redirects: RedirectRule[] = [
  // { source: "/eski-blog", destination: "/blogs/paginated", status: 301 },
];
