import { serializeEmbeddedJson } from "@originloom/shared/lib/embedded-json";

import { html, type HtmlNode, raw } from "../html.js";

export type IslandOptions = {
  name: string;
  /**
   * `hydrate` — the server renders the markup and the client wakes it up.
   *   Interactive but identical for every visitor, so it is safe inside cached HTML.
   *
   * `defer` — the server renders only the fallback; the client mounts it and
   *   fetches its own data. Anything per-user goes here: it never touches the
   *   cached HTML, so the cache key never grows a session dimension.
   */
  mode?: "hydrate" | "defer";
  /** Serialized into the marker and handed to the client module as its second argument. */
  props?: unknown;
  /** Load the chunk as soon as the page loads instead of waiting for the viewport. */
  eager?: boolean;
  children?: HtmlNode | string;
};

/**
 * Emits the island marker. Same contract as the React `<Island>` component —
 * the client bootstrap in `@originloom/shared` finds both by `data-island`.
 */
export function island({
  name,
  mode = "hydrate",
  props,
  eager,
  children,
}: IslandOptions): HtmlNode {
  const content = typeof children === "string" ? raw(children) : children;
  return html`<div
    data-island="${name}"
    data-mode="${mode}"
    ${eager ? raw('data-eager=""') : null}
    data-props="${serializeEmbeddedJson(props ?? {})}"
  >
    ${mode === "hydrate" ? content : html`<div data-fallback="">${content}</div>`}
  </div>`;
}
