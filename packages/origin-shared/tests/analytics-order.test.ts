import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  eventQueueScript,
  gtmStartScript,
  trackingIdPushScript,
} from "../src/lib/analytics/bootstrap.js";
import { configureAnalyticsFields } from "../src/lib/analytics/config.js";
import { pushPageView } from "../src/lib/analytics/page-view.js";

/**
 * The dataLayer is an ordered contract, not a bag.
 *
 * A tag that fires on `gtm.dom` reads the dimensions that are in the layer at
 * that moment. If the page view lands after it, the hit goes out without them —
 * and nothing errors, which is why this is asserted rather than assumed.
 */
type Entry = Record<string, unknown>;

function browser(cookie = ""): Entry[] {
  const layer: Entry[] = [];
  vi.stubGlobal("window", {
    dataLayer: layer,
    location: { pathname: "/", search: "", origin: "https://app.example" },
  });
  vi.stubGlobal("document", { cookie, currentScript: null });
  return layer;
}

/**
 * Runs a bootstrap script the way the browser would: as code, in the head.
 *
 * These builders return strings on purpose — nothing that ships in a bundle can
 * run early enough — so the only honest way to test them is to execute them.
 */
function run(code: string): void {
  runInNewContext(code, {
    window: globalThis.window,
    document: globalThis.document,
    setTimeout,
    clearTimeout,
    Date,
    RegExp,
  });
}

describe("the dataLayer order", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    configureAnalyticsFields({});
  });

  it("pushes the tracking id from the cookie, never from the server", () => {
    const layer = browser("user_tracking_id=d1195a49-29da-457b-bb56-bfa9ce641601");

    run(trackingIdPushScript({ trackingIdKey: "hkUserTrackingId" }));

    // The document is shared-cached. An id rendered into it would belong to
    // whoever filled the cache; read here, every visitor pushes their own.
    expect(layer).toEqual([{ hkUserTrackingId: "d1195a49-29da-457b-bb56-bfa9ce641601" }]);
    // A value the tags read, not something that happened — so no `event` key.
    expect(layer[0]).not.toHaveProperty("event");
  });

  it("pushes nothing when the visitor has no tracking cookie yet", () => {
    const layer = browser("");

    run(trackingIdPushScript({ trackingIdKey: "hkUserTrackingId" }));

    expect(layer.length).toBe(0);
  });

  it("holds gtm.dom and gtm.load until the page view has landed", () => {
    const layer = browser("user_tracking_id=abc");
    run(eventQueueScript());
    run(gtmStartScript());

    // GTM fires these on its own schedule, usually before React has mounted.
    (globalThis.window as unknown as { dataLayer: Entry[] }).dataLayer.push({ event: "gtm.dom" });
    (globalThis.window as unknown as { dataLayer: Entry[] }).dataLayer.push({ event: "gtm.load" });

    expect(layer.map((entry) => entry.event)).toEqual(["gtm.js"]);

    pushPageView({ pageType: "home", publicPath: "/", title: "Ana Sayfa" });

    // Released only now, so a tag firing on gtm.dom sees the page dimensions.
    expect(layer.map((entry) => entry.event)).toEqual([
      "gtm.js",
      "originalLocation",
      "GAVirtual",
      "gtm.dom",
      "gtm.load",
    ]);
  });

  it("releases the held events anyway when React never arrives", () => {
    vi.useFakeTimers();
    const layer = browser("");
    run(eventQueueScript({ failOpenMs: 5_000 }));

    (globalThis.window as unknown as { dataLayer: Entry[] }).dataLayer.push({ event: "gtm.dom" });
    // The queue replaces `push` on the array itself, so compare contents rather
    // than the object.
    expect(layer.map((entry) => entry.event)).toEqual([]);

    vi.advanceTimersByTime(5_000);

    // A page whose React never mounts should still report a visit: the
    // measurement is worth less than the page.
    expect(layer.map((entry) => entry.event)).toEqual(["gtm.dom"]);
    vi.useRealTimers();
  });

  it("emits the page view flat, under the product's own field names", () => {
    const layer = browser("");
    configureAnalyticsFields({ fieldPrefix: "HK_", pageViewEvent: "GAVirtual" });

    pushPageView({
      pageType: "home",
      publicPath: "/",
      title: "Ana Sayfa",
      category: "Ana Sayfa",
      experiment: "b",
    });

    const view = layer.find((entry) => entry.event === "GAVirtual");
    // Flat: a tag reads a dataLayer variable by name, and a nested object means
    // every dimension needs its own variable definition in the container UI.
    expect(view).toMatchObject({
      event: "GAVirtual",
      virtualPageUrl: "/",
      virtualPageTitle: "Ana Sayfa",
      HK_pageType: "home",
      HK_category: "Ana Sayfa",
      HK_experiment: "b",
    });
  });

  it("reports the address the visit started at, absolute and once", () => {
    const layer = browser("");

    pushPageView({ pageType: "home", publicPath: "/" });

    const first = layer.find((entry) => entry.event === "originalLocation");
    // Absolute, because attribution compares it against referrers and campaign
    // destinations that are absolute too.
    expect(first?.originalLocation).toBe("https://app.example/");
  });
});
