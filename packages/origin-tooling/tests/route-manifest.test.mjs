import { describe, expect, it } from "vitest";

import { createRouteManifest, renderRouteManifest } from "../bin/route-manifest-lib.mjs";

const description = Symbol.for("originloom.route-cache-description");

describe("route build manifest", () => {
  it("discovers every registry route instead of relying on a template list", () => {
    const shared = () => ({ kind: "shared", ttl: 60, key: ["new"] });
    shared[description] = { mode: "conditional", ttl: 60, swr: 300, vary: ["slug"] };
    const runtime = () => ({ kind: "none" });
    const manifest = createRouteManifest({
      routes: [
        { path: "/", cache: shared },
        { path: "/new/:slug", cache: runtime, streaming: true, validateParams: () => true },
      ],
      redirects: [{ source: "/old", destination: "/new/one", status: 308 }],
      rewrites: [{ source: "/public/:slug", destination: "/new/:slug" }],
    });

    expect(manifest.routes.map((route) => route.path)).toEqual(["/", "/new/:slug"]);
    expect(manifest.routes[0].cache).toMatchObject({ mode: "conditional", ttl: 60 });
    expect(manifest.routes[1]).toMatchObject({
      type: "streaming",
      validatesParams: true,
      cache: { mode: "runtime" },
    });
    expect(renderRouteManifest(manifest)).toContain("/new/:slug");
  });

  it("rejects duplicate paths because registry order cannot make them truthful", () => {
    expect(() => createRouteManifest({ routes: [{ path: "/same" }, { path: "/same" }] })).toThrow(
      "Duplicate route path: /same",
    );
  });
});
