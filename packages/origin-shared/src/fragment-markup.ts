/**
 * The `<ssr-fragment>` placeholder contract. Product components emit these
 * markers around regions the server re-resolves independently of the cached
 * document; the core finds them by scanning the rendered HTML. Every renderer
 * adapter has to serialize the marker the same way, so the pattern and the
 * replacement live here rather than inside the core.
 */
export const SSR_FRAGMENT_PATTERN =
  /<ssr-fragment name="([a-zA-Z0-9_-]+)" style="display:\s*contents">[\s\S]*?<\/ssr-fragment>/g;

export function ssrFragmentPlaceholder(name: string, html: string): string {
  return `<ssr-fragment name="${name}" style="display: contents">${html}</ssr-fragment>`;
}
