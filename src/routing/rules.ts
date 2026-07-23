import type { RedirectRule, RewriteRule } from "@originloom/react/routing/types";

/**
 * Next.js `rewrites()` equivalent. First match wins.
 *
 * - Internal destination → rewrite (browser URL unchanged, route matcher sees destination)
 * - External destination (http…) → proxy (forward request to backend/CDN)
 */
export function createRewrites(gatewayUrl: string): RewriteRule[] {
  // Keep the gateway argument in the public factory so deployments can build an explicit
  // external rewrite list without changing the routing bootstrap. Browser-facing gateway
  // endpoints must be added one-by-one; a `/api/:path*` pass-through would expose every
  // current and future upstream route.
  void gatewayUrl;
  return [
    {
      source: "/dob/assets/:path*",
      destination: "/assets/:path*",
    },
    {
      source: "/konut-kredisi",
      destination: "/housing-loans",
    },
    {
      source: "/konut-kredisi/:slug",
      destination: "/housing-loans/:slug",
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
export const redirects: RedirectRule[] = [];
