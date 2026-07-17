/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildEventQueueScript } from "~/components/analytics/gtm-bootstrap";

afterEach(() => {
  vi.useRealTimers();
  delete window.__ssrKitSignalReactReady;
  window.dataLayer = [];
});

describe("inline GTM event queue", () => {
  it("releases held lifecycle events when the analytics island never signals", async () => {
    vi.useFakeTimers();
    window.dataLayer = [];
    window.eval(buildEventQueueScript(50));

    window.dataLayer.push({ event: "gtm.dom" });
    window.dataLayer.push({ event: "gtm.load" });
    expect(window.dataLayer).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.stringify(window.dataLayer)).toBe('[{"event":"gtm.dom"},{"event":"gtm.load"}]');
  });

  it("preserves lifecycle events that arrive after an early React-ready signal", () => {
    window.dataLayer = [];
    window.eval(buildEventQueueScript(5_000));
    window.__ssrKitSignalReactReady?.();

    window.dataLayer.push({ event: "gtm.dom" });
    window.dataLayer.push({ event: "gtm.load" });

    expect(JSON.stringify(window.dataLayer)).toBe('[{"event":"gtm.dom"},{"event":"gtm.load"}]');
  });
});
