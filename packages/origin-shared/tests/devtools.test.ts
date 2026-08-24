// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Not just tidiness: a case that fails before its own cleanup would otherwise
  // leave fake timers installed for every test after it in this file.
  vi.useRealTimers();
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

  it("reads the cache phase duration from Server-Timing", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        responseStart: 14,
        domContentLoadedEventEnd: 38,
        loadEventEnd: 72,
        serverTiming: [{ name: "cache", description: "HIT", duration: 3.4 }],
      } as unknown as PerformanceNavigationTiming,
    ]);

    const snapshot = readDevtoolsSnapshot(page(""));

    expect(snapshot.cache).toEqual({ state: "HIT", durationMs: 3.4 });
    expect(snapshot.server).toEqual({});
    expect(snapshot.timing.loadMs).toBe(72);
  });

  /** The split is the point: a total says how long, the phases say which half. */
  it("reads the loader and render phases alongside the total", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        responseStart: 1712,
        domContentLoadedEventEnd: 1740,
        loadEventEnd: 1755,
        serverTiming: [
          { name: "cache", description: "BYPASS", duration: 1700 },
          { name: "loader", description: "", duration: 1412.4 },
          { name: "render", description: "", duration: 238.5 },
        ],
      } as unknown as PerformanceNavigationTiming,
    ]);

    const snapshot = readDevtoolsSnapshot(page(""));

    expect(snapshot.cache).toEqual({ state: "BYPASS", durationMs: 1700 });
    expect(snapshot.server).toEqual({ loaderMs: 1412.4, renderMs: 238.5 });
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

    const unmount = mountDevtoolsPanel({ document });
    const panel = document.getElementById("originloom-devtools");

    expect(panel?.textContent).toContain("MISS");
    expect(panel?.textContent).toContain("duration");
    expect(panel?.querySelector("[data-originloom-mark]")).not.toBeNull();
    expect(panel?.querySelector(".ol-details")?.hasAttribute("hidden")).toBe(true);

    panel?.querySelector<HTMLButtonElement>(".ol-toggle")?.click();
    expect(panel?.querySelector(".ol-toggle")?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.querySelector(".ol-details")?.hasAttribute("hidden")).toBe(false);
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

    const unmount = mountDevtoolsPanel({ document });
    const panel = document.getElementById("originloom-devtools");
    panel?.querySelector<HTMLButtonElement>(".ol-toggle")?.click();

    expect(panel?.querySelector("img")).toBeNull();
    expect(panel?.textContent).toContain("<img src=x onerror=alert(1)>");
    unmount();
  });

  it("replaces an existing panel instead of stacking copies", () => {
    page("");

    const unmountFirst = mountDevtoolsPanel({ document });
    const unmountSecond = mountDevtoolsPanel({ document });

    expect(document.querySelectorAll("#originloom-devtools")).toHaveLength(1);
    unmountFirst();
    unmountSecond();
  });

  it("breaks the server total down into its phases", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        responseStart: 1712,
        domContentLoadedEventEnd: 1740,
        loadEventEnd: 1755,
        serverTiming: [
          { name: "cache", description: "BYPASS", duration: 1700 },
          { name: "loader", description: "", duration: 1412.44 },
          { name: "render", description: "", duration: 238.5 },
        ],
      } as unknown as PerformanceNavigationTiming,
    ]);
    page("");

    const unmount = mountDevtoolsPanel({ document });
    document.querySelector<HTMLButtonElement>(".ol-toggle")?.click();
    const text = document.getElementById("originloom-devtools")?.textContent ?? "";

    expect(text).toContain("Server");
    expect(text).toContain("Loader");
    // Rounded at the edge, so a fractional server duration cannot blow out the cell.
    expect(text).toContain("1412.4ms");
    expect(text).toContain("238.5ms");
    unmount();
  });

  /** Production publishes no Server-Timing, so the section must simply not exist. */
  it("omits the server section when the response carried no phases", () => {
    page("");

    const unmount = mountDevtoolsPanel({ document });
    document.querySelector<HTMLButtonElement>(".ol-toggle")?.click();
    const headings = [...document.querySelectorAll(".ol-heading")].map(
      (heading) => heading.textContent,
    );

    expect(headings).not.toContain("Server");
    expect(headings).toContain("Navigation");
    unmount();
  });

  /**
   * The mark defines gradients, filters and markers, and an id inside an inline
   * SVG is global to the document it lands in. The panel is injected into
   * someone else's page, so a bare `coreBg` would be reassigned the moment the
   * host defines one too and the mark would paint wrong or not at all.
   */
  it("namespaces every id the mark defines, and references its own", () => {
    page("");

    const unmount = mountDevtoolsPanel({ document });
    const mark = document.querySelector("[data-originloom-mark]");
    const ids = [...(mark?.querySelectorAll("[id]") ?? [])].map((node) => node.id);

    expect(ids.length).toBeGreaterThan(6);
    expect(ids.every((id) => id.startsWith("originloom-devtools-"))).toBe(true);
    const references = [...(mark?.querySelectorAll("*") ?? [])].flatMap((node) =>
      ["fill", "stroke", "filter", "marker-end"]
        .map((name) => /url\(#([^)]+)\)/.exec(node.getAttribute(name) ?? "")?.[1])
        .filter((id): id is string => id !== undefined),
    );

    expect(references.length).toBeGreaterThan(6);
    for (const reference of references) expect(ids).toContain(reference);
    unmount();
  });

  /** Replaying the logo every time an island mounts is not a brand moment. */
  it("plays the mark's entrance once and then holds still", async () => {
    vi.useFakeTimers();
    page("");

    const unmount = mountDevtoolsPanel({ document });
    const panel = document.getElementById("originloom-devtools");
    expect(panel?.classList.contains("ol-intro")).toBe(true);

    vi.advanceTimersByTime(1_400);
    expect(panel?.classList.contains("ol-intro")).toBe(false);

    unmount();
    vi.useRealTimers();
  });

  it("can be disabled from code and closes an existing panel", () => {
    page("");

    const unmount = mountDevtoolsPanel({ document, enabled: true });
    expect(document.getElementById("originloom-devtools")).not.toBeNull();

    mountDevtoolsPanel({ document, enabled: false });
    expect(document.getElementById("originloom-devtools")).toBeNull();
    unmount();
  });
});

describe("the panel's own writes", () => {
  /**
   * The panel is appended to `document.body`, which is also what it observes.
   * Rendering into it therefore mutates the observed subtree — and if that
   * feeds straight back into the observer, the callback re-renders, mutates
   * again and never stops. In a browser that is a frozen tab, not a slow one.
   */
  it("does not re-trigger its own observer", async () => {
    page(`<div data-island="counter" data-mode="hydrate"></div>`);
    let renders = 0;
    const observer = new MutationObserver(() => {
      renders += 1;
    });

    const unmount = mountDevtoolsPanel({ document });
    observer.observe(document.body, { subtree: true, attributes: true, childList: true });

    // One unrelated mutation, the kind an island mounting produces.
    document.querySelector("[data-island]")?.setAttribute("data-hydrated", "");
    await new Promise((resolve) => setTimeout(resolve, 60));

    // A loop shows up as an ever-growing count; a settled panel does not.
    const afterFirstSettle = renders;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(renders).toBe(afterFirstSettle);
    observer.disconnect();
    unmount();
  });

  it("cancels a queued render when the panel is unmounted", async () => {
    page(`<div data-island="counter" data-mode="hydrate"></div>`);
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return 42;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const observe = vi.spyOn(MutationObserver.prototype, "observe");

    const unmount = mountDevtoolsPanel({ document });
    document.querySelector("[data-island]")?.setAttribute("data-hydrated", "");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestFrame).toHaveBeenCalledOnce();
    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(42);

    // Even if a host delivers an already-cancelled callback, it must not
    // resurrect the observer after cleanup.
    frames[0]?.(0);
    expect(observe).toHaveBeenCalledOnce();
    observe.mockRestore();
  });
});
