const MAX_CONTENT_URL_LENGTH = 2_048;

export type NavigationUrlOptions = {
  siteUrl: string;
  external?: boolean;
};

/**
 * Normalizes CMS/gateway navigation URLs at the content boundary.
 * Internal links must be root-relative (or an absolute same-origin URL).
 * Cross-origin links require an explicit `external` contract and HTTPS.
 */
export function normalizeNavigationUrl(
  value: string,
  options: NavigationUrlOptions,
): string | null {
  const input = validInput(value);
  if (!input || input.startsWith("//")) return null;

  const site = httpUrl(options.siteUrl);
  if (!site) return null;

  if (input.startsWith("/")) {
    const url = safeUrl(input, site);
    return url && url.origin === site.origin ? relativeUrl(url) : null;
  }

  const url = safeUrl(input);
  if (!url || url.username || url.password) return null;

  if (url.protocol === "http:" || url.protocol === "https:") {
    if (url.origin === site.origin) return relativeUrl(url);
    return options.external === true && url.protocol === "https:" ? url.toString() : null;
  }

  if (options.external === true && (url.protocol === "mailto:" || url.protocol === "tel:")) {
    return url.toString();
  }

  return null;
}

/** Canonical and og:url must always resolve to the configured public site origin. */
export function normalizeCanonicalUrl(value: string, siteUrl: string): string | null {
  const input = validInput(value);
  if (!input || input.startsWith("//")) return null;
  const site = httpUrl(siteUrl);
  if (!site) return null;
  const url = safeUrl(input, site);
  if (!url || url.origin !== site.origin || url.username || url.password) return null;
  url.hash = "";
  return url.toString();
}

/** OG/Twitter images may use the site origin or an absolute HTTPS image CDN. */
export function normalizeMetadataImageUrl(value: string, siteUrl: string): string | null {
  const input = validInput(value);
  if (!input || input.startsWith("//")) return null;
  const site = httpUrl(siteUrl);
  if (!site) return null;
  const url = safeUrl(input, site);
  if (!url || url.username || url.password) return null;
  if (url.origin === site.origin && (url.protocol === "http:" || url.protocol === "https:")) {
    return url.toString();
  }
  return url.protocol === "https:" ? url.toString() : null;
}

function validInput(value: string): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CONTENT_URL_LENGTH ||
    value !== value.trim() ||
    hasUnsafeUrlCharacters(value)
  ) {
    return null;
  }
  return value;
}

function hasUnsafeUrlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127 || character === "\\") return true;
  }
  return false;
}

function httpUrl(value: string): URL | null {
  const url = safeUrl(value);
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url : null;
}

function safeUrl(value: string, base?: URL): URL | null {
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}
