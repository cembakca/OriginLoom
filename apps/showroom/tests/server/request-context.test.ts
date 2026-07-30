import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import type { Route } from "@originloom/react/lib/types";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const passthroughCapacity = { run: <T>(_s: AbortSignal, work: () => Promise<T>) => work() };

const route: Route = {
  path: "/urunler/:slug",
  loader: async () => ({ data: {} }),
  Component: () => createElement("main", null, "detay"),
};

describe("request context in the document", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });
  afterEach(async () => {
    await closeCache();
  });

  it("carries the browser-visible path to the client half of the render", async () => {
    const app = createApp({
      assets,
      routes: [route],
      readinessCheck: async () => true,
      capacity: passthroughCapacity,
    });

    const html = await (await app.request("/urunler/kredi?utm_source=x")).text();

    // Islands are separate React roots: without this block they would hydrate
    // with no idea which page they are on, and a link inside one would disagree
    // with the same link outside it.
    const block = /<script type="application\/json" id="originloom-request">(.*?)<\/script>/s.exec(
      html,
    );
    expect(block, "the document must publish its request context").not.toBeNull();

    const context = JSON.parse(block?.[1] ?? "{}") as {
      publicPath?: string;
      search?: string;
      siteUrl?: string;
    };
    // The path the browser asked for, not the internal one a rewrite produced —
    // and the query with it, because a link that omits it is a different page.
    expect(context.publicPath).toBe("/urunler/kredi");
    expect(context.search).toBe("?utm_source=x");
    expect(context.siteUrl).toBeTruthy();
  });
});
