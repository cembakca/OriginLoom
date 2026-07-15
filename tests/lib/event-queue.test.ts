/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("event-queue", () => {
  beforeEach(async () => {
    vi.resetModules();
    window.dataLayer = [];
  });

  async function loadQueue() {
    const mod = await import("../../src/lib/analytics/event-queue");
    mod.resetEventQueueForTests();
    mod.installEventQueue();
    return mod;
  }

  it("holds gtm.dom until signalReactReady", async () => {
    const { signalReactReady } = await loadQueue();
    window.dataLayer.push({ event: "gtm.dom" });
    expect(window.dataLayer.some((e) => e.event === "gtm.dom")).toBe(false);

    signalReactReady();
    expect(window.dataLayer.some((e) => e.event === "gtm.dom")).toBe(true);
  });

  it("passes immediate events through", async () => {
    await loadQueue();
    window.dataLayer.push({ originalLocation: "/landing" });
    expect(window.dataLayer[0]).toEqual({ originalLocation: "/landing" });
  });

  it("releases gtm.load after gtm.dom", async () => {
    const { signalReactReady } = await loadQueue();
    window.dataLayer.push({ event: "gtm.dom" });
    window.dataLayer.push({ event: "gtm.load" });
    expect(window.dataLayer.length).toBe(0);

    signalReactReady();
    expect(window.dataLayer.map((e) => e.event)).toEqual(["gtm.dom", "gtm.load"]);
  });
});
