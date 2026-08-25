import type { RichText } from "@originloom/shared/lib/rich-text";
import { EMPTY_RICH_TEXT } from "@originloom/shared/lib/rich-text";
import sanitizeHtml from "sanitize-html";

/**
 * The elements a CMS field is allowed to carry.
 *
 * Derived from what the views actually style rather than from a wish list: the
 * FAQ accordion has rules for `p`, `ul`, `ol`, `table`, `th` and `td`, so those
 * are the shapes an editor is really producing. Anything outside the list is
 * dropped and its text is kept — a stray `<div>` becomes its own contents,
 * which is what an editor meant anyway.
 *
 * Widen this deliberately, one element at a time, with the view that needs it.
 * An allowlist that grows to match whatever arrived stops being one.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
];

/**
 * No `style`, no `class`, no `id`, no `data-*`, and no event handler by
 * construction.
 *
 * `style` is the one worth naming: it is not an XSS sink in a modern browser on
 * its own, but it is a layout sink, and CMS content that can position itself
 * over the page can build a clickjack out of a FAQ answer. The views own the
 * styling; the content owns the words.
 */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title", "target", "rel"],
  th: ["colspan", "rowspan", "scope"],
  td: ["colspan", "rowspan"],
};

/**
 * `javascript:` is the obvious one. `data:` is the one that gets forgotten —
 * a `data:text/html` link is a same-tab navigation into attacker-authored
 * markup, and it looks like an ordinary href in the CMS editor.
 */
const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ALLOWED_SCHEMES,
  // A protocol-relative href (`//evil.example`) inherits the page's scheme and
  // reads as a path to anyone skimming the CMS field.
  allowProtocolRelative: false,
  // `script`, `style` and friends lose their *contents* too, not just their
  // tags — keeping the text of a dropped `<script>` would paste its source into
  // the page as visible garbage at best.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe"],
  transformTags: {
    // A link that opens a new tab hands that tab a reference back to this one.
    // Editors do not think about `rel`; the platform does it for them, every
    // time, rather than trusting a checkbox in a CMS. Written after the spread
    // on purpose — an authored `rel="opener"` is overwritten, not merged with.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target
        ? { ...attribs, target: "_blank", rel: "noopener noreferrer" }
        : attribs,
    }),
  },
};

/**
 * Authored HTML from outside this application, reduced to what the views can
 * render.
 *
 * Call this **where the gateway payload becomes the view model** — in the
 * mapper, not in the component. Two reasons, and the second is the one that
 * bites: the result is what gets cached, so the work happens once per fill
 * rather than once per request; and a shared HTML cache that holds unsanitized
 * markup has already stored the problem, whatever the view does with it later.
 *
 * Returns `RichText`, which is the only way to obtain that type — see
 * `@originloom/shared/lib/rich-text` for why that matters more than the
 * allowlist itself.
 */
export function sanitizeRichText(raw: string | null | undefined): RichText {
  if (!raw) return EMPTY_RICH_TEXT;
  return sanitizeHtml(raw, OPTIONS) as RichText;
}
