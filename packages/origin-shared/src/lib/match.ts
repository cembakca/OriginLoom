import type { Route } from "./types.js";

/**
 * The complete router. Supports "/a/b", "/a/:id", "/a/:id?" and "/a/:rest*".
 * First match wins, so order your route table by specificity.
 */
export function match(routes: Route[], pathname: string) {
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

/** The same patterns, for anything that matches a path without being a route. */
export function matchesPath(pattern: string, pathname: string): boolean {
  return matchPath(pattern, pathname) !== null;
}

/**
 * A pattern that can never match anything, for a startup check.
 *
 * Only one shape qualifies: a rest parameter that is not the final segment.
 * `:rest*` consumes everything left, so anything written after it is
 * unreachable — and a pattern that silently never matches is the failure this
 * function exists to make loud.
 */
export function isUnreachablePattern(pattern: string): boolean {
  const segments = pattern.split("/").filter(Boolean);
  return segments.some((segment, index) => isRest(segment) && index !== segments.length - 1);
}

function isRest(segment: string): boolean {
  return segment.startsWith(":") && segment.endsWith("*");
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const pat = pattern.split("/").filter(Boolean);
  const seg = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  let i = 0;

  for (let index = 0; index < pat.length; index++) {
    const p = pat[index]!;
    if (isRest(p)) {
      // Everything that is left, including nothing: "/:path*" is what a table
      // writes when it means "this whole site", so it has to match "/" too.
      // Unreachable after a rest segment, which is why one is refused at
      // startup rather than quietly matching nothing here.
      if (index !== pat.length - 1) return null;
      const rest: string[] = [];
      for (const segment of seg.slice(i)) {
        try {
          rest.push(decodeURIComponent(segment));
        } catch {
          return null;
        }
      }
      params[p.slice(1, -1)] = rest.join("/");
      i = seg.length;
      break;
    }
    if (p.startsWith(":")) {
      const optional = p.endsWith("?");
      const name = p.slice(1).replace(/\?$/, "");
      if (i < seg.length) {
        const segment = seg[i++];
        if (segment !== undefined) {
          try {
            params[name] = decodeURIComponent(segment);
          } catch {
            return null;
          }
        }
      } else if (!optional) return null;
    } else {
      if (seg[i] !== p) return null;
      i++;
    }
  }

  return i === seg.length ? params : null;
}
