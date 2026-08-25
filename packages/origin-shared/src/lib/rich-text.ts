declare const richTextBrand: unique symbol;

/**
 * HTML that has been through the platform's sanitizer, and nothing else.
 *
 * A CMS field is authored HTML: the product needs the paragraphs, lists and
 * tables it carries, so escaping it is not an option and rendering it raw is
 * stored XSS waiting for one compromised account. The middle ground is an
 * allowlist — and the hard part of an allowlist is not writing it, it is being
 * sure every path reached it.
 *
 * That is what the brand is for. `RichText` cannot be produced by writing a
 * string; only `sanitizeRichText` (in `@originloom/core`, where the parser
 * lives) returns one. A mapper that forgets the call does not render unsafe
 * HTML — it fails to compile.
 *
 * The type lives here rather than next to the sanitizer because the components
 * that consume it are bundled for the browser, and this package is the half of
 * the platform that may be.
 */
export type RichText = string & { readonly [richTextBrand]: true };

/** The empty document — a field the CMS left blank, in the type the view wants. */
export const EMPTY_RICH_TEXT = "" as RichText;

/**
 * The `dangerouslySetInnerHTML` value, and the reason the sink is type-checked.
 *
 * `dangerouslySetInnerHTML={{ __html: value }}` accepts any string, so the
 * brand alone protects only the producer: it forces the mapper to sanitize, and
 * says nothing about what a later edit passes to the view. Going through this
 * function makes the consumer side a compile error too, which is the half that
 * a refactor six months from now actually runs into.
 */
export function richTextHtml(value: RichText): { __html: string } {
  return { __html: value };
}

/**
 * An escape hatch for HTML this codebase generated itself.
 *
 * Serialized bootstrap JSON, a GTM `<noscript>`, an inline analytics script —
 * markup the platform built from its own values, where sanitizing would strip
 * exactly the thing being emitted. Never reach for this with anything that came
 * off the network, and prefer to keep such a sink out of a product file at all.
 */
export function trustedRichText(html: string): RichText {
  return html as RichText;
}
