import type { Route } from "./types";

/**
 * The complete router. Supports "/a/b", "/a/:id", "/a/:id?".
 * First match wins, so order your route table by specificity.
 */
export function match(routes: Route[], pathname: string) {
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const pat = pattern.split("/").filter(Boolean);
  const seg = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  let i = 0;

  for (const p of pat) {
    if (p.startsWith(":")) {
      const optional = p.endsWith("?");
      const name = p.slice(1).replace(/\?$/, "");
      if (i < seg.length) params[name] = decodeURIComponent(seg[i++]);
      else if (!optional) return null;
    } else {
      if (seg[i] !== p) return null;
      i++;
    }
  }

  return i === seg.length ? params : null;
}
