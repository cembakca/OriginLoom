import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { mountApi } from "@server/api";
import { routes } from "@server/routes";
import { mountSeoRoutes } from "@server/seo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const capacity = { run: <T>(_signal: AbortSignal, work: () => Promise<T>) => work() };

/**
 * Where the transition names actually land in the document.
 *
 * The CSS was right from the start and a test proved it was in the head — but
 * `[data-view-transition='header']` matched the `ssr-fragment` wrapper, which is
 * `display: contents`. That element generates no principal box, and
 * `view-transition-name` on a box that is not rendered has no effect, so only
 * `<main>` was ever named. Nothing failed; the feature was simply absent.
 *
 * Asserting the tag the attribute sits on is the cheapest thing that can tell
 * those two states apart without a browser.
 */
describe("view transition names", () => {
  beforeAll(async () => {
    await closeCache();
    await initCache();
  });

  afterAll(async () => {
    await closeCache();
  });

  const app = createApp({
    assets,
    routes,
    capacity,
    mounts: { api: mountApi, seo: mountSeoRoutes },
    readinessCheck: async () => true,
  });

  async function chromeHtml(): Promise<string> {
    const response = await app.request("/kredi-kartlari");
    expect(response.status).toBe(200);
    return response.text();
  }

  it.each([
    ["header", "header"],
    ["footer", "footer"],
    ["main", "main"],
  ])("puts the %s name on an element that draws a box", async (role, tag) => {
    const html = await chromeHtml();
    const named = [...html.matchAll(/<([a-z-]+)(\s[^>]*)?\sdata-view-transition="([^"]+)"/g)];
    const carriers = named.filter((m) => m[3] === role).map((m) => m[1]);

    expect(carriers).toEqual([tag]);
  });

  /** A `display: contents` wrapper cannot carry one, and duplicates skip the transition. */
  it("names each role exactly once, and never on a stitching wrapper", async () => {
    const html = await chromeHtml();
    const roles = [...html.matchAll(/data-view-transition="([^"]+)"/g)].map((m) => m[1]);

    expect([...roles].sort()).toEqual(["footer", "header", "main"]);
    expect(html).not.toMatch(/<ssr-fragment[^>]*data-view-transition/);
  });
});
