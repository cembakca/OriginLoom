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

    const dest = isExternalUrl(rule.destination)
      ? buildExternalUrl(rule.destination, params)
      : applyPattern(rule.destination, params);
    const target = new URL(dest, url.origin);
    target.search = mergeSearchParams(url.searchParams, target.searchParams);

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

/** Incoming query is preserved; an explicit destination value wins for the same key. */
function mergeSearchParams(incoming: URLSearchParams, destination: URLSearchParams): string {
  const merged = new URLSearchParams(incoming);
  const destinationKeys = new Set(destination.keys());

  for (const key of destinationKeys) merged.delete(key);
  for (const [key, value] of destination) merged.append(key, value);

  return merged.toString();
}
