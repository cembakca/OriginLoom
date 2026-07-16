import type { RedirectRule, RewriteRule } from "./types";

/**
 * Next.js `rewrites()` equivalent. First match wins.
 *
 * - Internal destination → rewrite (browser URL unchanged, route matcher sees destination)
 * - External destination (http…) → proxy (forward request to backend/CDN)
 */
export function createRewrites(gatewayUrl: string): RewriteRule[] {
  return [
    {
      source: "/api/:path*",
      destination: `${gatewayUrl.replace(/\/$/, "")}/:path*`,
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
}

export const rewrites: RewriteRule[] = createRewrites("http://localhost:4002");

/**
 * Next.js `redirects()` equivalent. First match wins.
 * Runs BEFORE rewrites.
 */
export const redirects: RedirectRule[] = [
  // { source: "/eski-blog", destination: "/blogs/paginated", status: 301 },
];
