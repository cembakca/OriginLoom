const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape a value for interpolation into HTML text. Quotes are escaped too, so the
 * same output is safe inside an attribute value — see {@link escapeAttr}.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Escape a value for interpolation into a quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return escapeHtml(value);
}
