import { applyPattern, buildExternalUrl, isExternalUrl, matchPattern } from "./pattern";
import { createRewrites, redirects, rewrites } from "./rules";
import type { RouteResolution } from "./types";

/**
 * Resolve incoming URL → redirect | proxy | internal rewrite | pass-through.
 *
 *   publicPath  — browser-visible path (cache keys, canonical URLs)
 *   pathname    — path after rewrite (route matcher uses this)
 */
export function resolveRoute(url: URL, gatewayUrl?: string): RouteResolution {
  return resolveRouteWith(url, {
    redirects,
    rewrites: gatewayUrl ? createRewrites(gatewayUrl) : rewrites,
  });
}

/** Test helper — resolve with custom rule sets. */
export function resolveRouteWith(
  url: URL,
  opts: {
    redirects?: typeof redirects;
    rewrites?: typeof rewrites;
  },
): RouteResolution {
  const publicPath = url.pathname;
  const redirs = opts.redirects ?? redirects;
  const rws = opts.rewrites ?? rewrites;

  for (const rule of redirs) {
    const params = matchPattern(rule.source, publicPath);
    if (!params) continue;

    const dest = applyPattern(rule.destination, params);
    const target = new URL(dest, url.origin);
    target.search = url.search;

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
      target.search = url.search;
      return { kind: "proxy", url: target.toString() };
    }

    const pathname = applyPattern(rule.destination, params);
    return { kind: "rewrite", pathname, publicPath };
  }

  return { kind: "none", pathname: publicPath, publicPath };
}
