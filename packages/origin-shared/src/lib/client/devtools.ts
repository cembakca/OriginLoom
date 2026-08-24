/**
 * A dev-only panel for the things this architecture makes invisible.
 *
 * Every fact below is already produced — `x-cache` on the response, the cache
 * key the purge API speaks, the island markers in the DOM, the server-island
 * placeholders, the request id in the logs. What was missing is anywhere to see
 * them together, so answering "why is this page slow" or "why did that not
 * update" meant a terminal, a log query and a guess.
 *
 * Dev-only in the strict sense: the entry point returns immediately unless the
 * caller says otherwise, and the panel is mounted from a separate module so the
 * production bundle never contains it.
 */
export type DevtoolsSnapshot = {
  cache: { state: string; durationMs?: number | undefined };
  /**
   * The server-side phases behind this navigation, when the server published
   * them. Development only: the platform omits `Server-Timing` in production.
   */
  server: { loaderMs?: number | undefined; renderMs?: number | undefined };
  requestId?: string | undefined;
  islands: { name: string; mode: string; hydrated: boolean }[];
  serverIslands: { name: string; filled: boolean }[];
  timing: { ttfbMs?: number; domContentLoadedMs?: number; loadMs?: number };
};

export type DevtoolsOptions = {
  /** Mount the panel. Passing false also closes an already-mounted panel. */
  enabled?: boolean;
  /**
   * Alternate document, for tests. Timings still come from the ambient
   * `performance`, so this is not a way to inspect another browsing context.
   */
  document?: Document;
};

const PANEL_ID = "originloom-devtools";
const DETAILS_ID = "originloom-devtools-details";
const SVG_NS = "http://www.w3.org/2000/svg";
const mountedPanels = new WeakMap<Document, () => void>();

const DEVTOOLS_CSS = `
  #${PANEL_ID} {
    width: min(224px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow: hidden;
    border: 1px solid rgba(165, 180, 252, .2);
    border-radius: 20px;
    background:
      radial-gradient(circle at 18% 0%, rgba(99, 102, 241, .2), transparent 42%),
      rgba(8, 12, 24, .92);
    box-shadow: 0 18px 48px rgba(2, 6, 23, .3), inset 0 1px rgba(255, 255, 255, .05);
    color: #e5e7eb;
    font: 12px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    backdrop-filter: blur(18px) saturate(1.25);
    transition: width 180ms cubic-bezier(.2, .8, .2, 1), border-color 180ms ease;
  }
  #${PANEL_ID}[data-expanded] {
    width: min(340px, calc(100vw - 24px));
    overflow: auto;
    border-color: rgba(129, 140, 248, .34);
  }
  #${PANEL_ID} * { box-sizing: border-box; }
  #${PANEL_ID} .ol-toggle {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 18px;
    align-items: center;
    gap: 10px;
    padding: 9px;
    border-radius: 18px;
    cursor: pointer;
    transition: background 150ms ease;
  }
  #${PANEL_ID} .ol-toggle:hover { background: rgba(255, 255, 255, .045); }
  #${PANEL_ID} .ol-toggle:focus-visible {
    outline: 2px solid #818cf8;
    outline-offset: -2px;
  }
  #${PANEL_ID} .ol-mark {
    display: block;
    width: 40px;
    height: 40px;
    filter: drop-shadow(0 8px 14px rgba(45, 212, 191, .16));
  }
  #${PANEL_ID} .ol-brand { min-width: 0; }
  #${PANEL_ID} .ol-name-line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  #${PANEL_ID} .ol-name {
    color: #f8fafc;
    font-size: 12px;
    font-weight: 720;
    letter-spacing: -.015em;
  }
  #${PANEL_ID} .ol-dev {
    color: #a5b4fc;
    font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .12em;
  }
  #${PANEL_ID} .ol-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin-top: 4px;
    color: #94a3b8;
    font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  #${PANEL_ID} .ol-summary-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  #${PANEL_ID} .ol-summary-label { color: #64748b; }
  #${PANEL_ID} .ol-summary-value { color: #cbd5e1; font-weight: 650; }
  #${PANEL_ID} .ol-cache-value { color: var(--ol-status, #cbd5e1); }
  #${PANEL_ID} .ol-dot {
    width: 5px;
    height: 5px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--ol-status, #94a3b8);
    box-shadow: 0 0 8px color-mix(in srgb, var(--ol-status, #94a3b8) 60%, transparent);
  }
  #${PANEL_ID} .ol-separator { width: 1px; height: 10px; background: rgba(148, 163, 184, .2); }
  #${PANEL_ID} .ol-chevron {
    width: 16px;
    height: 16px;
    color: #64748b;
    transition: transform 180ms cubic-bezier(.2, .8, .2, 1), color 150ms ease;
  }
  #${PANEL_ID}[data-expanded] .ol-chevron { transform: rotate(180deg); color: #a5b4fc; }
  #${PANEL_ID} .ol-details {
    margin: 0 9px 9px;
    padding: 12px;
    border: 1px solid rgba(148, 163, 184, .12);
    border-radius: 14px;
    background: rgba(2, 6, 23, .4);
  }
  /* Only an explicit open or close reveals; a data update must not replay the
     animation underneath someone who is reading the panel. */
  #${PANEL_ID} .ol-details.ol-animate {
    animation: ol-reveal 180ms cubic-bezier(.2, .8, .2, 1) both;
  }
  #${PANEL_ID} .ol-details[hidden] { display: none; }
  #${PANEL_ID} .ol-heading {
    margin: 12px 0 6px;
    color: #64748b;
    font: 700 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  #${PANEL_ID} .ol-heading:first-child { margin-top: 0; }
  #${PANEL_ID} .ol-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    min-height: 22px;
    padding: 3px 0;
    color: #cbd5e1;
    font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  #${PANEL_ID} .ol-key { min-width: 0; color: #94a3b8; overflow-wrap: anywhere; }
  #${PANEL_ID} .ol-value { max-width: 62%; color: #e2e8f0; text-align: right; overflow-wrap: anywhere; }
  #${PANEL_ID} .ol-timing {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  #${PANEL_ID} .ol-timing-item {
    padding: 7px 8px;
    border: 1px solid rgba(148, 163, 184, .1);
    border-radius: 9px;
    background: rgba(15, 23, 42, .56);
  }
  #${PANEL_ID} .ol-timing-label {
    display: block;
    color: #64748b;
    font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  #${PANEL_ID} .ol-timing-value {
    display: block;
    margin-top: 5px;
    color: #e2e8f0;
    font: 650 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  #${PANEL_ID} .ol-empty { padding: 4px 0; color: #64748b; font-style: italic; }
  @keyframes ol-reveal {
    from { opacity: 0; transform: translateY(-4px) scale(.99); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    #${PANEL_ID}, #${PANEL_ID} .ol-toggle, #${PANEL_ID} .ol-chevron { transition: none; }
    #${PANEL_ID} .ol-details.ol-animate { animation: none; }
  }
`;

/**
 * Reads what the document and the Navigation Timing API already know.
 *
 * Deliberately observational: the panel never asks the server anything, so
 * opening it cannot change the page it is describing.
 */
export function readDevtoolsSnapshot(doc: Document = document): DevtoolsSnapshot {
  const meta = (name: string): string | undefined =>
    doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
  const serverTiming = readServerTiming();
  const cacheTiming = serverTiming.cache;

  const islands = [...doc.querySelectorAll<HTMLElement>("[data-island]")].map((element) => ({
    name: element.dataset.island ?? "",
    mode: element.dataset.mode ?? "hydrate",
    // The island runtime marks what it has mounted; anything unmarked is still
    // server markup, which is the interesting case.
    hydrated: element.hasAttribute("data-hydrated"),
  }));

  const serverIslands = [...doc.querySelectorAll<HTMLElement>("[data-server-island]")].map(
    (element) => ({
      name: element.dataset.serverIsland ?? "",
      filled: element.hasAttribute("data-filled"),
    }),
  );

  return {
    cache: {
      // The framework emits the state on `Server-Timing` only; the meta tag is
      // an escape hatch for a host app that prefers to put it in the document.
      state: cacheTiming?.state ?? meta("originloom:cache-state") ?? "unknown",
      ...(cacheTiming?.durationMs !== undefined ? { durationMs: cacheTiming.durationMs } : {}),
    },
    server: serverTiming.phases,
    ...(meta("originloom:request-id") ? { requestId: meta("originloom:request-id") } : {}),
    islands,
    serverIslands,
    timing: readTiming(),
  };
}

/**
 * What the server said about *this* navigation.
 *
 * Read from `Server-Timing` rather than the document, because the document is
 * the thing being cached: a HIT serves a body that was rendered during a MISS,
 * so anything baked into the HTML describes the wrong request. The header is
 * per-response and the browser exposes it here.
 *
 * The loader and render phases are what make the total actionable — a page that
 * spends its time in the loader is waiting on data, one that spends it in the
 * render is paying for markup, and the panel should not make anyone guess which.
 */
function readServerTiming(): {
  cache?: { state?: string; durationMs?: number };
  phases: DevtoolsSnapshot["server"];
} {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  const entries = navigation?.serverTiming ?? [];
  const find = (name: string) => entries.find((timing) => timing.name === name);
  const phaseMs = (name: string): number | undefined => {
    const entry = find(name);
    return entry && Number.isFinite(entry.duration) ? Math.max(0, entry.duration) : undefined;
  };

  const cache = find("cache");
  const loaderMs = phaseMs("loader");
  const renderMs = phaseMs("render");
  return {
    ...(cache
      ? {
          cache: {
            ...(cache.description ? { state: cache.description } : {}),
            ...(Number.isFinite(cache.duration) ? { durationMs: Math.max(0, cache.duration) } : {}),
          },
        }
      : {}),
    phases: {
      ...(loaderMs !== undefined ? { loaderMs } : {}),
      ...(renderMs !== undefined ? { renderMs } : {}),
    },
  };
}

function readTiming(): DevtoolsSnapshot["timing"] {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (!navigation) return {};
  return {
    ttfbMs: Math.round(navigation.responseStart),
    domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
    loadMs: Math.round(navigation.loadEventEnd),
  };
}

/**
 * Renders the panel into the document.
 *
 * Plain DOM rather than the app's own framework: the panel has to describe a
 * page whose framework may be mid-hydration or broken, and a debugging tool
 * that shares the machinery it is debugging is the one that goes dark exactly
 * when it is needed.
 */
export function mountDevtoolsPanel(options: DevtoolsOptions = {}): () => void {
  const doc = options.document ?? document;
  mountedPanels.get(doc)?.();
  if (options.enabled === false) return () => undefined;

  const panel = doc.createElement("aside");
  panel.id = PANEL_ID;
  panel.setAttribute("data-originloom-devtools", "");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "OriginLoom developer tools");
  panel.style.cssText = ["position:fixed", "right:14px", "bottom:14px", "z-index:2147483647"].join(
    ";",
  );

  // Built once and never re-inserted. A <style> element that comes and goes
  // with every render costs a whole-document style recalculation each time, and
  // the panel's own chrome is not what changes when the page does.
  const styles = doc.createElement("style");
  styles.textContent = DEVTOOLS_CSS;
  const content = doc.createElement("div");
  panel.append(styles, content);

  let expanded = false;
  let animateDetails = false;
  let rendered: string | undefined;
  const observer = new MutationObserver(() => scheduleRender());

  const render = () => {
    const snapshot = readDevtoolsSnapshot(doc);
    // Rebuilding when nothing the panel prints has changed would only throw
    // away the reader's focus, scroll position and text selection.
    const state = `${String(expanded)}\u0000${JSON.stringify(snapshot)}`;
    if (state === rendered) return;
    rendered = state;

    panel.toggleAttribute("data-expanded", expanded);
    // A background render must not drop the caret out of the panel; a render
    // the user asked for by clicking must leave focus on the button they hit.
    const keepFocus = panel.contains(doc.activeElement);

    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "ol-toggle";
    toggle.setAttribute("aria-controls", DETAILS_ID);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      expanded ? "Close OriginLoom developer tools" : "Open OriginLoom developer tools",
    );
    toggle.append(brandMark(doc), summary(doc, snapshot), chevron(doc));
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      animateDetails = true;
      // Drop any frame queued before the click: letting it land would rebuild
      // the panel again and take back the focus this render is about to set.
      cancelScheduled?.();
      cancelScheduled = undefined;
      queued = false;
      renderObserved();
    });

    const details = doc.createElement("div");
    details.id = DETAILS_ID;
    details.className = animateDetails ? "ol-details ol-animate" : "ol-details";
    details.hidden = !expanded;
    if (expanded) fillDetails(doc, details, snapshot);
    animateDetails = false;

    // `textContent` per node, never `innerHTML`: the panel prints values that
    // came from the page, so building markup out of them would make a debugging
    // tool the injection point.
    content.replaceChildren(toggle, details);
    if (keepFocus) toggle.focus({ preventScroll: true });
  };

  const OBSERVED: MutationObserverInit = {
    subtree: true,
    childList: true,
    // Only the markers the snapshot actually reads. Unfiltered, every class,
    // style or aria change anywhere on the page would wake the panel, which on
    // a page with an animating island means a callback per frame.
    attributeFilter: [
      "data-island",
      "data-mode",
      "data-hydrated",
      "data-server-island",
      "data-filled",
    ],
  };

  /** Render with the observer detached, so the panel's own writes are unobserved. */
  const renderObserved = () => {
    observer.disconnect();
    render();
    observer.observe(doc.body, OBSERVED);
  };

  /**
   * Islands mount and holes fill after first paint, so a static snapshot would
   * show a page that never existed — the panel has to watch.
   *
   * What it must not do is watch itself. The panel lives in `document.body`,
   * which is the subtree being observed, so writing into it is a mutation like
   * any other: the callback re-renders, that write fires the callback again,
   * and the tab locks up. Detaching around the write is what breaks that cycle.
   *
   * The frame also coalesces a burst — hydration touches many nodes at once,
   * and the panel only needs to describe where they landed.
   */
  let queued = false;
  let disposed = false;
  let cancelScheduled: (() => void) | undefined;
  const scheduleRender = () => {
    if (queued || disposed) return;
    queued = true;
    cancelScheduled = schedule(() => {
      queued = false;
      cancelScheduled = undefined;
      if (disposed) return;
      renderObserved();
    });
  };

  render();
  doc.body.appendChild(panel);
  observer.observe(doc.body, OBSERVED);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelScheduled?.();
    cancelScheduled = undefined;
    queued = false;
    observer.disconnect();
    panel.remove();
    if (mountedPanels.get(doc) === dispose) mountedPanels.delete(doc);
  };
  mountedPanels.set(doc, dispose);
  return dispose;
}

function summary(doc: Document, snapshot: DevtoolsSnapshot): HTMLElement {
  const brand = doc.createElement("div");
  brand.className = "ol-brand";

  const nameLine = doc.createElement("div");
  nameLine.className = "ol-name-line";
  const name = doc.createElement("span");
  name.className = "ol-name";
  name.textContent = "OriginLoom";
  const dev = doc.createElement("span");
  dev.className = "ol-dev";
  dev.textContent = "DEV";
  nameLine.append(name, dev);

  const metrics = doc.createElement("div");
  metrics.className = "ol-summary";
  const cache = summaryItem(doc, "cache", snapshot.cache.state);
  cache.style.setProperty("--ol-status", cacheColour(snapshot.cache.state));
  cache.querySelector(".ol-summary-value")?.classList.add("ol-cache-value");
  const dot = doc.createElement("span");
  dot.className = "ol-dot";
  cache.prepend(dot);

  const separator = doc.createElement("span");
  separator.className = "ol-separator";
  separator.setAttribute("aria-hidden", "true");
  metrics.append(cache, separator, summaryItem(doc, "duration", format(snapshot.cache.durationMs)));
  brand.append(nameLine, metrics);
  return brand;
}

function summaryItem(doc: Document, label: string, value: string): HTMLElement {
  const item = doc.createElement("span");
  item.className = "ol-summary-item";
  const key = doc.createElement("span");
  key.className = "ol-summary-label";
  key.textContent = label;
  const val = doc.createElement("span");
  val.className = "ol-summary-value";
  val.textContent = value;
  item.append(key, val);
  return item;
}

function fillDetails(doc: Document, details: HTMLElement, snapshot: DevtoolsSnapshot): void {
  details.append(heading(doc, "Request"), row(doc, "id", snapshot.requestId ?? "—"));

  // Loader and render are sequential, so they read as a breakdown of the cache
  // total rather than three unrelated numbers. Absent in production, where the
  // platform publishes no Server-Timing at all.
  const { loaderMs, renderMs } = snapshot.server;
  if (snapshot.cache.durationMs !== undefined || loaderMs !== undefined) {
    const server = doc.createElement("div");
    server.className = "ol-timing";
    server.append(
      timingItem(doc, "Total", format(snapshot.cache.durationMs)),
      timingItem(doc, "Loader", format(loaderMs)),
      timingItem(doc, "Render", format(renderMs)),
    );
    details.append(heading(doc, "Server"), server);
  }

  const timing = doc.createElement("div");
  timing.className = "ol-timing";
  timing.append(
    timingItem(doc, "TTFB", format(snapshot.timing.ttfbMs)),
    timingItem(doc, "DCL", format(snapshot.timing.domContentLoadedMs)),
    timingItem(doc, "Load", format(snapshot.timing.loadMs)),
  );
  details.append(heading(doc, "Navigation"), timing);

  const hydrated = snapshot.islands.filter((island) => island.hydrated).length;
  details.append(heading(doc, `Islands · ${hydrated}/${snapshot.islands.length}`));
  if (snapshot.islands.length === 0) details.append(empty(doc, "No client islands"));
  else {
    details.append(
      ...snapshot.islands.map((island) =>
        row(doc, island.name, `${island.mode}${island.hydrated ? " · ready" : " · pending"}`),
      ),
    );
  }

  if (snapshot.serverIslands.length > 0) {
    const filled = snapshot.serverIslands.filter((island) => island.filled).length;
    details.append(
      heading(doc, `Server islands · ${filled}/${snapshot.serverIslands.length}`),
      ...snapshot.serverIslands.map((island) =>
        row(doc, island.name, island.filled ? "filled" : "fallback"),
      ),
    );
  }
}

function brandMark(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  setSvgAttributes(svg, {
    class: "ol-mark",
    viewBox: "0 0 40 40",
    fill: "none",
    "aria-hidden": "true",
    "data-originloom-mark": "",
  });

  const halo = doc.createElementNS(SVG_NS, "circle");
  setSvgAttributes(halo, { cx: "20", cy: "20", r: "18.5", fill: "#0b1120" });

  // Two open strands interlock into the OriginLoom "O": server and client
  // stay separate, but meet around the same full document.
  const serverThread = doc.createElementNS(SVG_NS, "path");
  setSvgAttributes(serverThread, {
    d: "M10.2 29.8C4.8 24.4 5 15.3 10.7 9.8C16.1 4.6 24.7 4.8 30 9.9",
    stroke: "#8b5cf6",
    "stroke-width": "4.2",
    "stroke-linecap": "round",
  });
  const clientThread = doc.createElementNS(SVG_NS, "path");
  setSvgAttributes(clientThread, {
    d: "M29.8 10.2C35.2 15.6 35 24.7 29.3 30.2C23.9 35.4 15.3 35.2 10 30.1",
    stroke: "#2dd4bf",
    "stroke-width": "4.2",
    "stroke-linecap": "round",
  });

  const documentShadow = doc.createElementNS(SVG_NS, "path");
  setSvgAttributes(documentShadow, {
    d: "M14.5 12.5H22.8L26.5 16.2V27.5H14.5Z",
    fill: "#0b1120",
    stroke: "#111827",
    "stroke-width": "3.5",
    "stroke-linejoin": "round",
  });
  const documentPage = doc.createElementNS(SVG_NS, "path");
  setSvgAttributes(documentPage, {
    d: "M14.5 12.5H22.8L26.5 16.2V27.5H14.5Z",
    fill: "#111827",
    stroke: "#f8fafc",
    "stroke-width": "1.25",
    "stroke-linejoin": "round",
  });
  const fold = doc.createElementNS(SVG_NS, "path");
  setSvgAttributes(fold, {
    d: "M22.5 12.8V16.5H26.2",
    stroke: "#f8fafc",
    "stroke-width": "1.1",
    "stroke-linejoin": "round",
  });
  const serverIsland = doc.createElementNS(SVG_NS, "rect");
  setSvgAttributes(serverIsland, {
    x: "17.2",
    y: "19",
    width: "3.1",
    height: "3.1",
    rx: ".75",
    fill: "#8b5cf6",
  });
  const clientIsland = doc.createElementNS(SVG_NS, "rect");
  setSvgAttributes(clientIsland, {
    x: "21.5",
    y: "19",
    width: "3.1",
    height: "3.1",
    rx: ".75",
    fill: "#2dd4bf",
  });
  const documentLine = doc.createElementNS(SVG_NS, "path");
  setSvgAttributes(documentLine, {
    d: "M17.2 24.5H23.8",
    stroke: "#94a3b8",
    "stroke-width": "1.15",
    "stroke-linecap": "round",
  });

  svg.append(
    halo,
    serverThread,
    clientThread,
    documentShadow,
    documentPage,
    fold,
    serverIsland,
    clientIsland,
    documentLine,
  );
  return svg;
}

function chevron(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  setSvgAttributes(svg, {
    class: "ol-chevron",
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": "true",
  });
  const path = doc.createElementNS(SVG_NS, "path");
  setSvgAttributes(path, {
    d: "m4 6 4 4 4-4",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svg.append(path);
  return svg;
}

function setSvgAttributes(element: Element, attributes: Record<string, string>): void {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
}

function cacheColour(state: string): string {
  switch (state.toUpperCase()) {
    case "HIT":
      return "#34d399";
    case "MISS":
      return "#fbbf24";
    case "BYPASS":
      return "#a78bfa";
    case "STALE":
      return "#38bdf8";
    default:
      return "#94a3b8";
  }
}

/** A cancellable frame where there is one, a cancellable timeout where there is not. */
function schedule(work: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(work);
    return () => cancelAnimationFrame(frame);
  }

  const timer = setTimeout(work, 16);
  return () => clearTimeout(timer);
}

function heading(doc: Document, text: string): HTMLElement {
  const element = doc.createElement("div");
  element.className = "ol-heading";
  element.textContent = text;
  return element;
}

function row(doc: Document, label: string, value: string): HTMLElement {
  const element = doc.createElement("div");
  element.className = "ol-row";

  const key = doc.createElement("span");
  key.className = "ol-key";
  key.textContent = label;

  const val = doc.createElement("span");
  val.className = "ol-value";
  val.textContent = value;

  element.append(key, val);
  return element;
}

function timingItem(doc: Document, label: string, value: string): HTMLElement {
  const item = doc.createElement("div");
  item.className = "ol-timing-item";
  const key = doc.createElement("span");
  key.className = "ol-timing-label";
  key.textContent = label;
  const val = doc.createElement("span");
  val.className = "ol-timing-value";
  val.textContent = value;
  item.append(key, val);
  return item;
}

function empty(doc: Document, text: string): HTMLElement {
  const element = doc.createElement("div");
  element.className = "ol-empty";
  element.textContent = text;
  return element;
}

function format(ms: number | undefined): string {
  if (ms === undefined) return "—";
  // Server phases arrive fractional; rounding at the edge keeps a cell from
  // becoming "1412.4400000000001ms" and blowing out the column.
  return `${Number.isInteger(ms) ? ms : Math.round(ms * 10) / 10}ms`;
}
