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
  cache: { state: string };
  requestId?: string | undefined;
  islands: { name: string; mode: string; hydrated: boolean }[];
  serverIslands: { name: string; filled: boolean }[];
  timing: { ttfbMs?: number; domContentLoadedMs?: number; loadMs?: number };
};

const PANEL_ID = "originloom-devtools";

/**
 * Reads what the document and the Navigation Timing API already know.
 *
 * Deliberately observational: the panel never asks the server anything, so
 * opening it cannot change the page it is describing.
 */
export function readDevtoolsSnapshot(doc: Document = document): DevtoolsSnapshot {
  const meta = (name: string): string | undefined =>
    doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;

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
    cache: { state: readCacheState() ?? meta("originloom:cache-state") ?? "unknown" },
    ...(meta("originloom:request-id") ? { requestId: meta("originloom:request-id") } : {}),
    islands,
    serverIslands,
    timing: readTiming(),
  };
}

/**
 * The cache state of *this* navigation.
 *
 * Read from `Server-Timing` rather than the document, because the document is
 * the thing being cached: a HIT serves a body that was rendered during a MISS,
 * so anything baked into the HTML describes the wrong request. The header is
 * per-response and the browser exposes it here.
 */
function readCacheState(): string | undefined {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  const entry = navigation?.serverTiming?.find((timing) => timing.name === "cache");
  return entry?.description || undefined;
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
export function mountDevtoolsPanel(doc: Document = document): () => void {
  doc.getElementById(PANEL_ID)?.remove();

  const panel = doc.createElement("aside");
  panel.id = PANEL_ID;
  panel.setAttribute("data-originloom-devtools", "");
  panel.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "z-index:2147483647",
    "max-width:360px",
    "max-height:60vh",
    "overflow:auto",
    "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
    "background:#0f172a",
    "color:#e2e8f0",
    "border-radius:8px",
    "box-shadow:0 8px 24px rgba(0,0,0,.35)",
    "padding:12px 14px",
  ].join(";");

  const render = () => {
    const snapshot = readDevtoolsSnapshot(doc);
    // `textContent` per node, never `innerHTML`: the panel prints values that
    // came from the page, so building markup out of them would make a debugging
    // tool the injection point.
    panel.replaceChildren(
      heading(doc, "OriginLoom"),
      row(doc, "cache", snapshot.cache.state),
      row(doc, "request", snapshot.requestId ?? "—"),
      row(doc, "ttfb", format(snapshot.timing.ttfbMs)),
      row(doc, "dcl", format(snapshot.timing.domContentLoadedMs)),
      heading(
        doc,
        `islands (${snapshot.islands.filter((i) => i.hydrated).length}/${snapshot.islands.length})`,
      ),
      ...snapshot.islands.map((island) =>
        row(doc, island.name, `${island.mode}${island.hydrated ? " · hydrated" : ""}`),
      ),
      ...(snapshot.serverIslands.length > 0
        ? [
            heading(
              doc,
              `server islands (${snapshot.serverIslands.filter((i) => i.filled).length}/${snapshot.serverIslands.length})`,
            ),
            ...snapshot.serverIslands.map((island) =>
              row(doc, island.name, island.filled ? "filled" : "fallback"),
            ),
          ]
        : []),
    );
  };

  render();
  doc.body.appendChild(panel);

  // Islands mount and holes fill after first paint, so a static snapshot would
  // show a page that never existed.
  const observer = new MutationObserver(render);
  observer.observe(doc.body, { subtree: true, attributes: true, childList: true });

  return () => {
    observer.disconnect();
    panel.remove();
  };
}

function heading(doc: Document, text: string): HTMLElement {
  const element = doc.createElement("div");
  element.textContent = text;
  element.style.cssText = "margin:8px 0 4px;color:#94a3b8;text-transform:uppercase;font-size:10px";
  return element;
}

function row(doc: Document, label: string, value: string): HTMLElement {
  const element = doc.createElement("div");
  element.style.cssText = "display:flex;gap:8px;justify-content:space-between";

  const key = doc.createElement("span");
  key.textContent = label;
  key.style.color = "#94a3b8";

  const val = doc.createElement("span");
  val.textContent = value;

  element.append(key, val);
  return element;
}

function format(ms: number | undefined): string {
  return ms === undefined ? "—" : `${ms}ms`;
}
