# @originloom/vanilla

The framework-free renderer for [OriginLoom](https://github.com/cembakca/OriginLoom). Pages are
functions that return HTML; islands are plain modules. Implements the same `OriginRenderer`
contract `@originloom/react` does, so the server core cannot tell the difference.

```bash
pnpm add @originloom/core @originloom/vanilla @originloom/shared
```

## Pages

`html` escapes every interpolated value, so untrusted content is safe by default. Nested nodes and
`raw()` are inserted verbatim, arrays are concatenated, and `null` / `undefined` / `false` render as
nothing:

```ts
import { html } from "@originloom/vanilla/html";

export function catalogPage({ data }: { data: { items: Item[] } }) {
  return html`<ul>
    ${data.items.map((item) => html`<li><a href="/items/${item.slug}">${item.name}</a></li>`)}
  </ul>`;
}
```

## Renderer

```ts
import { metadataHead } from "@originloom/vanilla/lib/metadata-head";
import { createHtmlRenderer } from "@originloom/vanilla/server";

export const productRenderer = createHtmlRenderer<ShellData>({
  notFoundPage,
  errorPage,
  renderHeadStart: ({ seo, cspNonce }) => metadataHead(seo, cspNonce),
  renderLayout: ({ shell, children }) => layout(shell, children),
});
```

## Islands

Same marker contract as the React adapter — only the mount step differs. An island module receives
the server-rendered element and its props:

```ts
import { island } from "@originloom/vanilla/lib/island";

island({ name: "counter", props: { start: 0 }, children: html`<button>Sayaç: 0</button>` });
```

```ts
// src/islands/counter.ts
import type { IslandMount } from "@originloom/vanilla/client/island-mount";

const mount: IslandMount = (element, props) => {
  const button = element.querySelector("button");
  let count = Number(props.start ?? 0);
  button?.addEventListener("click", () => (button.textContent = `Sayaç: ${++count}`));
};

export default mount;
```

## Streaming

There are no deferred boundaries without a framework, so `renderDocumentToStream` produces the
document as a single ready chunk. A route marked `streaming: true` still works — it simply has
nothing to defer.
