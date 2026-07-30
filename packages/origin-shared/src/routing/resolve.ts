import { applyPattern, buildExternalUrl, isExternalUrl, matchPattern } from "./pattern.js";
import { mergeSearchParams } from "./query.js";
import type { RedirectRule, RewriteRule, RouteResolution } from "./types.js";

export type RoutingRulesConfig = {
  redirects: readonly RedirectRule[];
  rewrites: readonly RewriteRule[];
  /** Gateway-bound rewrites; used when resolveRoute receives a gatewayUrl. */
  createRewrites?: (gatewayUrl: string) => readonly RewriteRule[];
};

let configured: RoutingRulesConfig = { redirects: [], rewrites: [] };
let configuredGatewayRewrites: { gatewayUrl: string; rules: readonly RewriteRule[] } | undefined;

/** Install the app's routing rules once at startup (composition root / test setup). */
export function configureRouting(rules: RoutingRulesConfig): void {
  configured = rules;
  configuredGatewayRewrites = undefined;
}

/**
 * Resolve incoming URL → redirect | proxy | internal rewrite | pass-through.
 *
 *   publicPath  — browser-visible path (cache keys, canonical URLs)
 *   pathname    — path after rewrite (route matcher uses this)
 */
export function resolveRoute(url: URL, gatewayUrl?: string): RouteResolution {
  return resolveRouteWith(url, {
    redirects: configured.redirects,
    rewrites: resolveConfiguredRewrites(gatewayUrl),
  });
}

function resolveConfiguredRewrites(gatewayUrl?: string): readonly RewriteRule[] {
  if (!gatewayUrl || !configured.createRewrites) return configured.rewrites;
  if (configuredGatewayRewrites?.gatewayUrl === gatewayUrl) return configuredGatewayRewrites.rules;
  const rules = configured.createRewrites(gatewayUrl);
  configuredGatewayRewrites = { gatewayUrl, rules };
  return rules;
}

/** Resolve with explicit rule sets (tests, custom pipelines). */
export function resolveRouteWith(
  url: URL,
  opts: {
    redirects?: readonly RedirectRule[];
    rewrites?: readonly RewriteRule[];
  },
): RouteResolution {
  const publicPath = url.pathname;
  const redirs = opts.redirects ?? configured.redirects;
  const rws = opts.rewrites ?? configured.rewrites;

  for (const rule of redirs) {
    const params = matchPattern(rule.source, publicPath);
    if (!params) continue;

    const dest = isExternalUrl(rule.destination)
      ? buildExternalUrl(rule.destination, params)
      : applyPattern(rule.destination, params);
    const target = new URL(dest, url.origin);
    target.search = mergeSearchParams(url.searchParams, target.searchParams);
    target.hash = "";

    return {
      kind: "redirect",
      url: target.toString(),
      status: rule.status ?? 308,
    };
  }

  for (const rule of rws) {
    const params = matchPattern(rule.source, publicPath);
    if (!params) continue;

    if (isExternalUrl(rule.destination)) {
      const external = buildExternalUrl(rule.destination, params);
      const target = new URL(external);
      target.search = mergeSearchParams(url.searchParams, target.searchParams);
      target.hash = "";
      return { kind: "proxy", url: target.toString() };
    }

    const destination = new URL(applyPattern(rule.destination, params), url.origin);
    destination.search = mergeSearchParams(url.searchParams, destination.searchParams);
    return {
      kind: "rewrite",
      pathname: destination.pathname,
      search: destination.search,
      publicPath,
    };
  }

  return { kind: "none", pathname: publicPath, publicPath };
}
