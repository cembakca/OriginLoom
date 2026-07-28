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
    if (p === undefined) return null;

    if (p.endsWith("*")) {
      const name = p.slice(1, -1); // :path* → path
      const decoded = decodeSegments(seg.slice(i));
      if (!decoded) return null;
      params[name] = decoded.join("/");
      return pi === pat.length - 1 ? params : null;
    }

    if (p.startsWith(":")) {
      const optional = p.endsWith("?");
      const name = p.slice(1).replace(/\?$/, "");
      if (i < seg.length) {
        const segment = seg[i++];
        if (segment !== undefined) {
          const decoded = decodeSegment(segment);
          if (decoded === null) return null;
          params[name] = decoded;
        }
      } else if (!optional) return null;
      continue;
    }

    if (seg[i] !== p) return null;
    i++;
  }

  return i === seg.length ? params : null;
}

/** Replace :param and :path* placeholders in destination. */
export function applyPattern(template: string, params: Record<string, string>): string {
  const url = interpolateUrl(template, params);
  return url.pathname + url.search;
}

export function isExternalUrl(destination: string): boolean {
  return /^https?:\/\//i.test(destination);
}

export function buildExternalUrl(template: string, params: Record<string, string>): string {
  return interpolateUrl(template, params).toString();
}

const PARAM_TOKEN = /:([A-Za-z_][A-Za-z0-9_]*)(\*)?/g;

function interpolateUrl(template: string, params: Record<string, string>): URL {
  const url = new URL(template, "http://rewrite.local");
  url.pathname = url.pathname.replace(PARAM_TOKEN, (_token, name: string, splat: string) => {
    const value = params[name];
    if (value === undefined) return _token;
    return splat
      ? value
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/")
      : encodeURIComponent(value);
  });

  const interpolatedQuery = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    interpolatedQuery.append(key, interpolateQueryValue(value, params));
  }
  url.search = interpolatedQuery.toString();
  return url;
}

function interpolateQueryValue(value: string, params: Record<string, string>): string {
  return value.replace(PARAM_TOKEN, (token, name: string) => params[name] ?? token);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function decodeSegments(segments: string[]): string[] | null {
  const decoded: string[] = [];
  for (const segment of segments) {
    const value = decodeSegment(segment);
    if (value === null) return null;
    decoded.push(value);
  }
  return decoded;
}
