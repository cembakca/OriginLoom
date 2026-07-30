/**
 * What an app is allowed to put in an internal link, decided once.
 *
 * Framework-neutral on purpose: the rule is about URLs, not about React. The
 * adapter's `<Link>` applies it; anything else that emits an href can too.
 */
export type LinkKind =
  /** A path on this site. */
  | "internal"
  /** Somewhere else — another origin, or protocol-relative, which is the same thing. */
  | "external"
  /** A fragment or a bare query: it stays on the page it was written for. */
  | "inert"
  /** A scheme that executes rather than navigates. Never rendered as a link. */
  | "unsafe";

/**
 * Schemes a link must never carry. `javascript:` and `vbscript:` execute in the
 * page's own origin; `data:` and `blob:` can carry a document that then does. A
 * link is a navigation, and these are not navigations.
 */
const UNSAFE_SCHEMES = ["javascript:", "vbscript:", "data:", "blob:", "file:"];

/**
 * Browsers ignore whitespace and control characters while parsing a scheme, so
 * a tab inside "javascript:" still navigates like "javascript:". Anything
 * deciding whether a URL is safe has to read it the way the browser will.
 */
function schemeCandidate(href: string): string {
  let candidate = "";
  for (const character of href) {
    if ((character.codePointAt(0) ?? 0) > 0x20) candidate += character;
  }
  return candidate.toLowerCase();
}

export function classifyHref(href: string, siteUrl?: string): LinkKind {
  const value = href.trim();
  const candidate = schemeCandidate(value);
  if (UNSAFE_SCHEMES.some((scheme) => candidate.startsWith(scheme))) return "unsafe";
  if (value.startsWith("#") || value.startsWith("?")) return "inert";
  // `//host/path` is a URL on another host wearing the costume of a path.
  if (value.startsWith("//")) return "external";
  if (value.startsWith("/")) return "internal";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return "inert";

  const base = siteUrl ?? "";
  try {
    return new URL(value).origin === new URL(base).origin ? "internal" : "external";
  } catch {
    return "external";
  }
}

export type LinkAttributes = {
  /** Absent when the href was refused: the element renders, the navigation does not. */
  href?: string;
  rel?: string;
  kind: LinkKind;
};

/**
 * The attributes a link should actually carry.
 *
 * A refused href is dropped rather than rewritten to "#": a link that silently
 * goes nowhere is easier to notice than one that goes somewhere unexpected, and
 * an anchor without href is not focusable, so it also stops advertising itself
 * as a link to assistive technology.
 */
export function resolveLinkAttributes(
  href: string,
  options: {
    target?: string | undefined;
    rel?: string | undefined;
    siteUrl?: string | undefined;
  } = {},
): LinkAttributes {
  const kind = classifyHref(href, options.siteUrl);
  if (kind === "unsafe") return { kind, ...(options.rel ? { rel: options.rel } : {}) };

  const rel = relFor(kind, options.target, options.rel);
  return { kind, href, ...(rel ? { rel } : {}) };
}

/**
 * `target="_blank"` hands the opened page a reference back to this one unless
 * `noopener` says otherwise, and leaks this URL as its referrer unless
 * `noreferrer` does. Both belong on any link that opens a new context.
 *
 * A plain cross-site link does not get `noreferrer` added: the referrer is how
 * the other end attributes the visit, and silently removing it changes what the
 * app reports to its partners.
 */
function relFor(kind: LinkKind, target: string | undefined, rel: string | undefined): string {
  const tokens = new Set((rel ?? "").split(/\s+/).filter(Boolean));
  if (target === "_blank") {
    tokens.add("noopener");
    tokens.add("noreferrer");
  } else if (kind === "external") {
    tokens.add("noopener");
  }
  return [...tokens].join(" ");
}

/**
 * True when a link points at the page currently being rendered.
 *
 * The query counts: page 2 of a list is not page 1, and marking the link back to
 * page 1 as the current page is worse than marking nothing. A link that omits
 * the query the visitor arrived with — a tracking parameter, say — is simply not
 * matched, which is a miss rather than a lie.
 */
export function isCurrentPath(href: string, publicPath: string | undefined, search = ""): boolean {
  if (!publicPath || !href.startsWith("/")) return false;
  const [path = "", query = ""] = href.split("#")[0]?.split("?") ?? [];
  return (
    normalizePath(path) === normalizePath(publicPath) &&
    normalizeSearch(query) === normalizeSearch(search)
  );
}

function normalizeSearch(search: string): string {
  return search.replace(/^\?/, "");
}

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
