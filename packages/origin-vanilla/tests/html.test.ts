import { describe, expect, it } from "vitest";

import { html, isHtmlNode, joinHtml, raw } from "../src/html.js";
import { island } from "../src/lib/island.js";

describe("html tagged template", () => {
  it("escapes interpolated values by default", () => {
    const name = `<img src=x onerror="alert(1)">`;
    expect(html`<p>${name}</p>`.html).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  });

  it("escapes values interpolated into attributes", () => {
    const href = `/x" onmouseover="alert(1)`;
    expect(html`<a href="${href}">x</a>`.html).toBe(
      '<a href="/x&quot; onmouseover=&quot;alert(1)">x</a>',
    );
  });

  it("inserts nested nodes and raw() verbatim", () => {
    const inner = html`<b>${"a&b"}</b>`;
    expect(html`<p>${inner}${raw("<hr/>")}</p>`.html).toBe("<p><b>a&amp;b</b><hr/></p>");
  });

  it("joins arrays and drops nullish or false values", () => {
    const items = ["a", "b"].map((value) => html`<li>${value}</li>`);
    expect(joinHtml(items).html).toBe("<li>a</li><li>b</li>");
    expect(html`${items}`.html).toBe("<li>a</li><li>b</li>");
    expect(html`${null}${undefined}${false}`.html).toBe("");
  });

  it("keeps the template's own whitespace — it is HTML, not JSX", () => {
    // Prettier formats html`` templates as embedded HTML, so authors get the
    // usual HTML whitespace rules. joinHtml is the way out where it matters.
    expect(html`<span> ${"a"} </span>`.html).toBe("<span> a </span>");
  });

  it("renders numbers", () => {
    expect(html`<span>${42}</span>`.html).toBe("<span>42</span>");
  });

  it("recognizes its own nodes", () => {
    expect(isHtmlNode(html`x`)).toBe(true);
    expect(isHtmlNode("x")).toBe(false);
  });
});

describe("island marker", () => {
  it("emits the same contract the client bootstrap looks for", () => {
    const markup = island({
      name: "counter",
      props: { start: 3 },
      eager: true,
      children: html`<button>0</button>`,
    }).html;

    expect(markup).toContain('data-island="counter"');
    expect(markup).toContain('data-mode="hydrate"');
    expect(markup).toContain('data-eager=""');
    expect(markup).toContain('data-props="{&quot;start&quot;:3}"');
    expect(markup).toContain("<button>0</button>");
  });

  it("wraps deferred content in a fallback container", () => {
    const markup = island({ name: "panel", mode: "defer", children: html`<p>yükleniyor</p>` }).html;
    expect(markup).toContain('data-mode="defer"');
    expect(markup).toContain('<div data-fallback=""');
  });

  it("escapes props that try to break out of the attribute", () => {
    const markup = island({ name: "x", props: { evil: `" onload="alert(1)` } }).html;
    expect(markup).not.toContain('onload="alert(1)"');
  });
});
