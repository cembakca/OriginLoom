/**
 * @vitest-environment jsdom
 *
 * The client half of the island contract: markup produced by `island()` on the
 * server is picked up by the shared bootstrap and handed to a plain module.
 */
import { bootstrapIslandElements } from "@originloom/shared/lib/client/island-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  createIslandMounter,
  type IslandModule,
  type IslandMount,
} from "../src/client/island-mount.js";
import { html } from "../src/html.js";
import { island } from "../src/lib/island.js";

function render(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  const element = document.body.querySelector<HTMLElement>("[data-island]");
  if (!element) throw new Error("island marker not found");
  return element;
}

function moduleOf(mount: IslandMount): () => Promise<IslandModule> {
  return () => Promise.resolve({ default: mount });
}

describe("island mounting", () => {
  it("hands the server-rendered element and its props to the module", async () => {
    const element = render(
      island({
        name: "counter",
        props: { start: 3 },
        children: html`<button type="button">Sayaç: 3</button>`,
      }).html,
    );

    const mount = vi.fn<IslandMount>((el, props) => {
      const button = el.querySelector("button");
      if (button) button.textContent = `Sayaç: ${Number(props.start) + 1}`;
    });

    await createIslandMounter({ modules: { "./islands/counter.ts": moduleOf(mount) } })(element);

    expect(mount).toHaveBeenCalledOnce();
    expect(mount.mock.calls[0]?.[1]).toEqual({ start: 3 });
    // The server markup was there to enhance, not to replace.
    expect(element.querySelector("button")?.textContent).toBe("Sayaç: 4");
  });

  it("survives a module that throws instead of taking the page down", async () => {
    const element = render(island({ name: "broken", children: html`<i>x</i>` }).html);
    const mount = () => {
      throw new Error("boom");
    };

    await expect(
      createIslandMounter({ modules: { "./islands/broken.ts": moduleOf(mount) } })(element),
    ).resolves.toBeUndefined();
  });

  it("ignores a marker with no matching module", async () => {
    const element = render(island({ name: "missing", children: html`<i>x</i>` }).html);
    await expect(createIslandMounter({ modules: {} })(element)).resolves.toBeUndefined();
  });

  it("starts eager islands immediately and defers the rest to the observer", () => {
    document.body.innerHTML =
      island({ name: "a", eager: true, children: html`<i>a</i>` }).html +
      island({ name: "b", children: html`<i>b</i>` }).html;
    const elements = document.body.querySelectorAll<HTMLElement>("[data-island]");
    const started: string[] = [];

    // No IntersectionObserver in this environment: lazy islands start at once,
    // which is the documented fallback.
    bootstrapIslandElements(elements, (el) => started.push(el.dataset.island ?? ""), {
      observer: null,
    });

    expect(started).toEqual(["a", "b"]);
  });
});
