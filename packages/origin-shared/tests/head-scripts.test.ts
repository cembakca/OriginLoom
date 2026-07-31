import { createContext, runInContext, runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  type HeadScript,
  sequencedScript,
  type SequencedScriptOptions,
} from "../src/head-scripts.js";

type FakeScript = {
  src?: string;
  text?: string;
  nonce?: string;
  async?: boolean;
  fire: (type: "load" | "error") => void;
};

type Harness = {
  /** Scripts the sequencer has injected, in the order it injected them. */
  injected: FakeScript[];
  /** What the inline steps did, in the order they ran. */
  order: string[];
  /** Settle the external step currently in flight. */
  finish: (type?: "load" | "error") => void;
  /** Fire a window event the sequencer may be waiting on. */
  emit: (type: string) => void;
  /** Run every timer whose deadline has passed. */
  advance: (ms: number) => void;
  nonce?: string;
};

/**
 * Runs the emitted code against a document that behaves the way a browser's
 * does for the parts the sequencer relies on: appending a script with `text`
 * executes it, appending one with `src` does not settle until it loads.
 *
 * jsdom cannot stand in here — it does not execute dynamically appended
 * scripts at all, so the ordering under test would never happen.
 */
function run(
  steps: readonly HeadScript[],
  options: SequencedScriptOptions = {},
  nonce = "",
): Harness {
  const injected: FakeScript[] = [];
  const order: string[] = [];
  const listeners = new Map<string, Array<() => void>>();
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let now = 0;
  let nextTimerId = 1;

  const sandbox = {
    window: { order },
    order,
    setTimeout(fn: () => void, ms: number) {
      const id = nextTimerId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(id: number) {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index !== -1) timers.splice(index, 1);
    },
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    document: {
      currentScript: { nonce },
      createElement(): FakeScript {
        const handlers = new Map<string, Array<() => void>>();
        return {
          addEventListener(type: string, listener: () => void) {
            handlers.set(type, [...(handlers.get(type) ?? []), listener]);
          },
          fire(type: "load" | "error") {
            for (const handler of handlers.get(type) ?? []) handler();
          },
        } as unknown as FakeScript;
      },
      head: {
        appendChild(element: FakeScript) {
          injected.push(element);
          // A browser runs an inline script the moment it is appended.
          if (element.text !== undefined) runInContext(element.text, context);
        },
      },
    },
  };

  const context = createContext(sandbox);
  runInContext(sequencedScript(steps, options), context);

  return {
    injected,
    order,
    finish(type = "load") {
      const pending = injected.filter((script) => script.src !== undefined).at(-1);
      pending?.fire(type);
    },
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers]) {
        if (timer.at <= now) {
          sandbox.clearTimeout(timer.id);
          timer.fn();
        }
      }
    },
    nonce,
  };
}

describe("sequencedScript", () => {
  it("holds each step until the one before it has finished", () => {
    const harness = run([
      { src: "https://vendor.example/consent.js" },
      { code: 'window.order.push("dataLayer")' },
      { src: "https://vendor.example/tag.js" },
    ]);

    // Only the first step is in flight; nothing behind it may have run.
    expect(harness.injected).toHaveLength(1);
    expect(harness.order).toEqual([]);

    harness.finish();

    expect(harness.order).toEqual(["dataLayer"]);
    expect(harness.injected.at(-1)?.src).toBe("https://vendor.example/tag.js");
  });

  it("loads external steps with async off, so nothing can overtake", () => {
    const harness = run([{ src: "https://vendor.example/a.js" }]);

    expect(harness.injected[0]?.async).toBe(false);
  });

  it("waits for a vendor that becomes usable later than it executes", () => {
    const harness = run([
      { src: "https://vendor.example/consent.js", awaitEvent: "consent:ready" },
      { code: 'window.order.push("after-consent")' },
    ]);

    harness.finish();
    // Executed is not ready: the step is done loading and still not finished.
    expect(harness.order).toEqual([]);

    harness.emit("consent:ready");
    expect(harness.order).toEqual(["after-consent"]);
  });

  it("carries on past a vendor that never loads, rather than stranding the rest", () => {
    const harness = run(
      [{ src: "https://dead.example/tag.js" }, { code: 'window.order.push("still-ran")' }],
      { timeoutMs: 2_000 },
    );

    expect(harness.order).toEqual([]);
    harness.advance(1_999);
    expect(harness.order).toEqual([]);
    harness.advance(1);
    expect(harness.order).toEqual(["still-ran"]);
  });

  it("carries on when a vendor answers with an error", () => {
    const harness = run([
      { src: "https://vendor.example/404.js" },
      { code: 'window.order.push("after-error")' },
    ]);

    harness.finish("error");
    expect(harness.order).toEqual(["after-error"]);
  });

  it("gives a slow step its own budget without changing the others", () => {
    const harness = run(
      [
        { src: "https://slow.example/a.js", timeoutMs: 10_000 },
        { code: 'window.order.push("after-slow")' },
      ],
      { timeoutMs: 1_000 },
    );

    harness.advance(1_000);
    expect(harness.order).toEqual([]);
    harness.advance(9_000);
    expect(harness.order).toEqual(["after-slow"]);
  });

  it("puts its own nonce on every script it injects", () => {
    const harness = run([{ src: "https://vendor.example/tag.js" }], {}, "n0nce");

    // Without this the injected scripts are refused by a nonce-based CSP: the
    // sequence would work in development and silently do nothing in production.
    expect(harness.injected[0]?.nonce).toBe("n0nce");
  });

  it("refuses a step that is neither a URL nor code", () => {
    expect(() => sequencedScript([{}])).toThrow(/exactly one/);
    expect(() => sequencedScript([{ src: "https://x.example/a.js", code: "1" }])).toThrow(
      /exactly one/,
    );
  });

  it("escapes embedded markup so step data cannot end the script element", () => {
    const code = sequencedScript([{ code: 'window.name="</script><img onerror=1>"' }]);

    expect(code).not.toContain("</script>");
    expect(code).toContain("\\u003c");
  });
});

describe("waiting for a dataLayer event", () => {
  it("continues on a dataLayer push, which is not a DOM event", () => {
    const code = sequencedScript([
      { src: "https://consent.example/efilli.js", awaitDataLayerEvent: "efilli.consent" },
      { code: "window.__afterConsent = true;" },
    ]);

    // A consent tool announces itself with `dataLayer.push({event})`. Waiting for
    // a window event of the same name would never fire, and the step behind it
    // would be delayed by the whole timeout — on every page.
    expect(code).toContain("awaitDataLayerEvent");
    expect(code).toContain("awaitPush");
  });

  it("counts an event that was already pushed", () => {
    const code = sequencedScript([
      { src: "https://consent.example/efilli.js", awaitDataLayerEvent: "efilli.consent" },
    ]);

    // A script that pushes while it executes does so before its own `load`
    // fires, so the watcher would attach too late to ever see it.
    expect(code).toContain("for(var j=0;j<window.dataLayer.length;j++)");
  });
});

describe("a consent tool that pushes more than one entry", () => {
  /** A head that runs inline scripts on append and remembers external ones. */
  function fakeHead() {
    const layer: Record<string, unknown>[] = [];
    const external: { src: string; fire: (name: string) => void }[] = [];
    const window = { dataLayer: layer } as Record<string, unknown>;
    const document = {
      currentScript: { nonce: "" },
      head: {
        appendChild(el: Record<string, unknown>) {
          if (typeof el.text === "string") {
            runInNewContext(el.text, { window, document });
            return;
          }
          const listeners: Record<string, () => void> = el.listeners as Record<string, () => void>;
          external.push({ src: el.src as string, fire: (name) => listeners[name]?.() });
        },
      },
      createElement() {
        const listeners: Record<string, () => void> = {};
        return {
          listeners,
          addEventListener(name: string, fn: () => void) {
            listeners[name] = fn;
          },
        } as Record<string, unknown>;
      },
    };
    return { layer, external, window, document };
  }

  it("lets the tool finish before the next step runs", async () => {
    vi.useFakeTimers();
    const { layer, external, window, document } = fakeHead();

    runInNewContext(
      sequencedScript([
        { src: "https://efilli.example/e.js", awaitDataLayerEvent: "efilli.consent" },
        { code: 'window.dataLayer.push({ hkUserTrackingId: "abc" });' },
        { code: 'window.dataLayer.push({ event: "gtm.js" });' },
      ]),
      { window, document, setTimeout, clearTimeout, addEventListener: () => {} },
    );

    external[0]?.fire("load");
    // Efilli announces itself with two entries, in one synchronous block — the
    // shape a real consent tool has.
    (window.dataLayer as Record<string, unknown>[]).push({ event: "efilli.consent" });
    (window.dataLayer as Record<string, unknown>[]).push({ event: "efilli_essential_granted" });

    await vi.advanceTimersByTimeAsync(1);

    // Continuing inside the first push would have put the tracking id between
    // the tool's own two entries.
    expect(layer.map((entry) => entry.event ?? Object.keys(entry)[0])).toEqual([
      "efilli.consent",
      "efilli_essential_granted",
      "hkUserTrackingId",
      "gtm.js",
    ]);
    vi.useRealTimers();
  });
});
