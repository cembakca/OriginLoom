// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { mountDevtoolsPanel, readDevtoolsSnapshot } from "../src/lib/client/devtools.js";

function page(body: string, meta: Record<string, string> = {}): Document {
  document.head.innerHTML = Object.entries(meta)
    .map(([name, content]) => `<meta name="${name}" content="${content}">`)
    .join("");
  document.body.innerHTML = body;
  return document;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("readDevtoolsSnapshot", () => {
  it("reads the facts the page already carries", () => {
    const doc = page(
      `<div data-island="counter" data-mode="hydrate" data-hydrated></div>
       <div data-island="live" data-mode="defer"></div>
       <div data-server-island="visitor-summary" data-filled></div>`,
      { "originloom:cache-state": "HIT", "originloom:request-id": "req-42" },
    );

    const snapshot = readDevtoolsSnapshot(doc);

    expect(snapshot.cache.state).toBe("HIT");
    expect(snapshot.requestId).toBe("req-42");
    expect(snapshot.islands).toEqual([
      { name: "counter", mode: "hydrate", hydrated: true },
      { name: "live", mode: "defer", hydrated: false },
    ]);
    expect(snapshot.serverIslands).toEqual([{ name: "visitor-summary", filled: true }]);
  });

  it("says so rather than guessing when the markers are absent", () => {
    const snapshot = readDevtoolsSnapshot(page(""));

    expect(snapshot.cache.state).toBe("unknown");
    expect(snapshot.requestId).toBeUndefined();
    expect(snapshot.islands).toEqual([]);
  });

  /** An unfilled placeholder is the interesting case: it means the fallback is showing. */
  it("distinguishes a filled server island from one still on its fallback", () => {
    const doc = page(
      `<div data-server-island="a"></div><div data-server-island="b" data-filled></div>`,
    );

    expect(readDevtoolsSnapshot(doc).serverIslands).toEqual([
      { name: "a", filled: false },
      { name: "b", filled: true },
    ]);
  });
});

describe("mountDevtoolsPanel", () => {
  it("renders the snapshot and cleans up after itself", () => {
    page(`<div data-island="counter" data-mode="hydrate" data-hydrated></div>`, {
      "originloom:cache-state": "MISS",
    });

    const unmount = mountDevtoolsPanel(document);
    const panel = document.getElementById("originloom-devtools");

    expect(panel?.textContent).toContain("MISS");
    expect(panel?.textContent).toContain("counter");

    unmount();
    expect(document.getElementById("originloom-devtools")).toBeNull();
  });

  /**
   * The panel prints values that came from the page, so it builds nodes and
   * sets `textContent`. Rendering them as markup would make a debugging tool
   * the injection point.
   */
  it("never turns page values into markup", () => {
    page(`<div data-island="&lt;img src=x onerror=alert(1)&gt;" data-mode="hydrate"></div>`);

    mountDevtoolsPanel(document);
    const panel = document.getElementById("originloom-devtools");

    expect(panel?.querySelector("img")).toBeNull();
    expect(panel?.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("replaces an existing panel instead of stacking copies", () => {
    page("");

    mountDevtoolsPanel(document);
    mountDevtoolsPanel(document);

    expect(document.querySelectorAll("#originloom-devtools")).toHaveLength(1);
  });
});
