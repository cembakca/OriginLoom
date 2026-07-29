/**
 * The `<ssr-fragment>` placeholder contract. Product components emit these
 * markers around regions the server re-resolves independently of the cached
 * document; the core finds them by scanning the rendered HTML. Every renderer
 * adapter has to serialize the marker the same way, so the pattern and the
 * replacement live here rather than inside the core.
 */
export const SSR_FRAGMENT_PATTERN =
  /<ssr-fragment name="([a-zA-Z0-9_-]+)" style="display:\s*contents">[\s\S]*?<\/ssr-fragment>/g;

export type SsrFragmentMarker = { name: string; start: number; end: number };

/** Compile marker offsets once when HTML enters cache; cache hits can stitch by slicing. */
export function findSsrFragmentMarkers(html: string): SsrFragmentMarker[] {
  if (!html.includes("<ssr-fragment ")) return [];
  return [...html.matchAll(SSR_FRAGMENT_PATTERN)].map((match) => ({
    name: match[1]!,
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function ssrFragmentPlaceholder(name: string, html: string): string {
  return `<ssr-fragment name="${name}" style="display: contents">${html}</ssr-fragment>`;
}
