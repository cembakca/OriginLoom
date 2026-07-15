/**
 * Pattern syntax (Next.js-compatible subset):
 *   /foo/bar           — static segments
 *   /basvuru/:page/... — named param (one segment)
 *   /api/:path*        — splat (rest of path, stored as `path`)
 */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const pat = pattern.split("/").filter(Boolean);
  const seg = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  let i = 0;

  for (let pi = 0; pi < pat.length; pi++) {
    const p = pat[pi];

    if (p.endsWith("*")) {
      const name = p.slice(1, -1); // :path* → path
      params[name] = seg.slice(i).map(decodeURIComponent).join("/");
      return pi === pat.length - 1 ? params : null;
    }

    if (p.startsWith(":")) {
      const optional = p.endsWith("?");
      const name = p.slice(1).replace(/\?$/, "");
      if (i < seg.length) params[name] = decodeURIComponent(seg[i++]);
      else if (!optional) return null;
      continue;
    }

    if (seg[i] !== p) return null;
    i++;
  }

  return i === seg.length ? params : null;
}

/** Replace :param and :path* placeholders in destination. */
export function applyPattern(template: string, params: Record<string, string>): string {
  let out = template;

  for (const [key, value] of Object.entries(params)) {
    out = out.replace(new RegExp(`:${key}\\*`, "g"), value);
    out = out.replace(new RegExp(`:${key}\\??`, "g"), value);
  }

  const url = new URL(out, "http://rewrite.local");
  return url.pathname + url.search;
}

export function isExternalUrl(destination: string): boolean {
  return /^https?:\/\//i.test(destination);
}

export function buildExternalUrl(template: string, params: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(new RegExp(`:${key}\\*`, "g"), value);
    out = out.replace(new RegExp(`:${key}\\??`, "g"), value);
  }
  return out;
}
