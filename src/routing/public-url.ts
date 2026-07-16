export type PublicUrlPolicy = {
  casePolicy?: "preserve" | "lowercase";
  unicodeNormalization?: "NFC" | "NFKC";
};

export type PublicUrlNormalization =
  | { kind: "ok"; pathname: string }
  | { kind: "redirect"; pathname: string; location: string }
  | { kind: "invalid"; reason: "malformed-encoding" | "encoded-separator" | "control-character" };

/**
 * Establishes one browser-visible path identity before redirects, rewrites,
 * route matching and cache-key generation.
 */
export function normalizePublicUrl(url: URL, policy: PublicUrlPolicy = {}): PublicUrlNormalization {
  const segments: string[] = [];

  for (const rawSegment of url.pathname.split("/")) {
    if (!rawSegment) continue;

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      return { kind: "invalid", reason: "malformed-encoding" };
    }

    if (decoded.includes("/") || decoded.includes("\\")) {
      return { kind: "invalid", reason: "encoded-separator" };
    }
    if (hasControlCharacter(decoded)) {
      return { kind: "invalid", reason: "control-character" };
    }

    const unicodeForm = policy.unicodeNormalization ?? "NFC";
    const unicodeNormalized = decoded.normalize(unicodeForm);
    const caseNormalized = (
      policy.casePolicy === "lowercase" ? unicodeNormalized.toLowerCase() : unicodeNormalized
    ).normalize(unicodeForm);
    segments.push(encodeURIComponent(caseNormalized));
  }

  const pathname = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  if (pathname === url.pathname) return { kind: "ok", pathname };

  const target = new URL(url);
  target.pathname = pathname;
  return { kind: "redirect", pathname, location: target.toString() };
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
