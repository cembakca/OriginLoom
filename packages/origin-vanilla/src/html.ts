import { escapeHtml } from "@originloom/shared/html";

/**
 * A piece of already-safe markup. Producing one is the only way to get raw HTML
 * past the `html` tag's escaping, which keeps interpolation safe by default —
 * the property a string-templating renderer has to earn and JSX gets for free.
 */
export type HtmlNode = { readonly html: string };

export type HtmlValue = HtmlNode | string | number | boolean | null | undefined | HtmlValue[];

/** Marks a string as trusted markup. Never call it on gateway or user input. */
export function raw(value: string): HtmlNode {
  return { html: value };
}

export function isHtmlNode(value: unknown): value is HtmlNode {
  return (
    typeof value === "object" && value !== null && typeof (value as HtmlNode).html === "string"
  );
}

/**
 * Tagged template that escapes every interpolated value. Nested `HtmlNode`s
 * (from `html` or `raw`) are inserted verbatim; arrays are concatenated;
 * `null`, `undefined` and `false` render as nothing, so `cond && html\`…\``
 * works the way it does in JSX.
 */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): HtmlNode {
  let out = strings[0] ?? "";
  for (const [index, value] of values.entries()) {
    out += stringify(value) + (strings[index + 1] ?? "");
  }
  return { html: out };
}

/** Serializes a node to the HTML string the server sends. */
export function renderHtml(node: HtmlNode): string {
  return node.html;
}

/**
 * Concatenates values with no separator, applying the same escaping rules as
 * `html`. Use it where the template's own indentation would end up in the
 * output — the document head, or a list of tags.
 */
export function joinHtml(values: HtmlValue[]): HtmlNode {
  return { html: values.map(stringify).join("") };
}

function stringify(value: HtmlValue): string {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (Array.isArray(value)) return value.map(stringify).join("");
  if (isHtmlNode(value)) return value.html;
  return escapeHtml(String(value));
}
