// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The instrument installs its listeners once per module instance, on purpose — a
 * second `pageshow` listener would report one restore as two. So each case takes
 * a fresh module, which is also the only way to get fresh listeners.
 */
async function reportBackForwardCache(): Promise<void> {
  vi.resetModules();
  const module = await import("../src/lib/client/performance-telemetry.js");
  module.reportBackForwardCache();
}

/**
 * The instrument is the deliverable for bfcache, so its parser is the thing
 * that has to be right. A silently wrong reason is worse than no reason: it
 * becomes a metric label that sends someone looking for a blocker that is not
 * there.
 */
const sent: Record<string, unknown>[] = [];

/**
 * The instrument has no teardown, because in a page it is installed once and
 * lives as long as the document. Tests share one jsdom window, so they have to
 * take back what they added or the next case hears the previous case's listener.
 */
const installed: [string, EventListener][] = [];

beforeEach(() => {
  sent.length = 0;
  installed.length = 0;
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ) => {
    installed.push([type, listener]);
    add(type, listener, options);
  }) as typeof window.addEventListener);
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      // The telemetry transport always sends a JSON string; anything else here
      // would be the transport changing shape, which is worth failing on.
      const body = init?.body;
      if (typeof body !== "string") throw new TypeError("expected a JSON body");
      sent.push(JSON.parse(body) as Record<string, unknown>);
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
});

afterEach(() => {
  for (const [type, listener] of installed) window.removeEventListener(type, listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function navigationEntry(notRestoredReasons: unknown) {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { notRestoredReasons } as unknown as PerformanceNavigationTiming,
  ]);
}

describe("reportBackForwardCache", () => {
  it("reports nothing when the browser offers neither signal", async () => {
    navigationEntry(null);

    await reportBackForwardCache();

    expect(sent).toEqual([]);
  });

  /** `persisted` is the browser saying the page came back alive. */
  it("reports a restore when the page came back from the cache", async () => {
    navigationEntry(null);
    await reportBackForwardCache();

    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));

    expect(sent).toEqual([
      expect.objectContaining({ kind: "bfcache", outcome: "restored", reason: "restored" }),
    ]);
  });

  it("ignores an ordinary load, which also fires pageshow", async () => {
    navigationEntry(null);
    await reportBackForwardCache();

    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));

    expect(sent).toEqual([]);
  });

  /**
   * Chrome nests the reasons by frame. A blocked restore is blocked whichever
   * frame caused it, and the frame tree cannot become a metric label without
   * unbounded cardinality — so the tree is flattened and deduplicated.
   */
  it("flattens the reasons out of the frame tree and drops duplicates", async () => {
    navigationEntry({
      reasons: [{ reason: "response-cache-control-no-store" }],
      children: [
        { reasons: [{ reason: "unload-handler" }] },
        {
          reasons: [{ reason: "response-cache-control-no-store" }],
          children: [{ reasons: [{ reason: "websocket" }] }],
        },
      ],
    });

    await reportBackForwardCache();

    expect(sent.map((metric) => metric.reason)).toEqual([
      "response-cache-control-no-store",
      "unload-handler",
      "websocket",
    ]);
    expect(sent.every((metric) => metric.outcome === "blocked")).toBe(true);
  });

  it("caps how many reasons one navigation can report", async () => {
    navigationEntry({
      reasons: Array.from({ length: 20 }, (_, index) => ({ reason: `reason-${index}` })),
    });

    await reportBackForwardCache();

    expect(sent).toHaveLength(8);
  });

  /** A shape we did not expect is not a reason; inventing one would be a lie. */
  it("skips entries that carry no usable reason", async () => {
    navigationEntry({ reasons: [{ reason: "" }, {}, { reason: "unload-handler" }] });

    await reportBackForwardCache();

    expect(sent.map((metric) => metric.reason)).toEqual(["unload-handler"]);
  });

  it("waits for load when the navigation is not finished yet", async () => {
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    navigationEntry({ reasons: [{ reason: "unload-handler" }] });

    await reportBackForwardCache();
    expect(sent).toEqual([]);

    window.dispatchEvent(new Event("load"));
    expect(sent.map((metric) => metric.reason)).toEqual(["unload-handler"]);
  });
});
