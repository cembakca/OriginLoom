import { escapeAttr } from "@originloom/shared/html";

import type { HtmlNode } from "./html.js";

export type Attributes = Record<string, string | number | boolean | undefined>;

/**
 * Builds an element from an attribute record.
 *
 * Prettier formats `html` templates as embedded HTML, which is what you want in
 * app code but not for platform output: it would put the template's indentation
 * into every response. Attribute records are immune to that, so the markup this
 * package emits stays compact whatever the source looks like.
 *
 * `true` renders a bare attribute, `false`/`undefined` drops it, everything else
 * is escaped. Omit `children` for a self-closing tag.
 */
export function tag(name: string, attributes: Attributes, children?: HtmlNode | null): HtmlNode {
  let out = `<${name}`;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    out += value === true ? ` ${key}` : ` ${key}="${escapeAttr(String(value))}"`;
  }
  out += children === undefined ? " />" : `>${children?.html ?? ""}</${name}>`;
  return { html: out };
}
