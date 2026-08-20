import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { SsrCapacity } from "@originloom/core/ssr-capacity";
import type { Route } from "@originloom/react/lib/types";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };

describe("SSR capacity cache fast path", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    await closeCache();
  });

  it("serves cached GET pages without acquiring render admission", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const slowRoute: Route = {
      path: "/slow",
      loader: async () => {
        await slowGate;
        return { data: { text: "slow" } };
      },
      Component: ({ data }) => createElement("p", null, (data as { text: string }).text),
    };

    const cachedRoute: Route = {
      path: "/cached",
      cache: () => ({ kind: "shared", ttl: 60, key: ["cached"] }),
      loader: async () => ({ data: { text: "cached" } }),
      Component: ({ data }) => createElement("p", null, (data as { text: string }).text),
      minimalChrome: true,
    };

    const capacity = new SsrCapacity(1, 0, 100);
    const app = createApp({
      assets,
      routes: [slowRoute, cachedRoute],
      readinessCheck: async () => true,
      capacity,
    });

    expect((await app.request("http://localhost/cached")).headers.get("x-cache")).toBe("MISS");
    expect((await app.request("http://localhost/cached")).headers.get("x-cache")).toBe("HIT");

    const slow = app.request("http://localhost/slow");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const hits = await Promise.all([
      app.request("http://localhost/cached"),
      app.request("http://localhost/cached"),
      app.request("http://localhost/cached"),
    ]);

    for (const response of hits) {
      expect(response.status).toBe(200);
      expect(response.headers.get("x-cache")).toBe("HIT");
    }

    releaseSlow?.();
    await slow;
  });
});
