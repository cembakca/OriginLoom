import type { CachePolicy } from "@originloom/shared/lib/types";
import { describe, expect, it } from "vitest";

import { htmlResponse } from "../src/ssr/response.js";

const shared: CachePolicy = { kind: "shared", ttl: 60, key: ["home"] };

describe("HTML Server-Timing", () => {
  it("keeps cache state and its server-side duration on the same metric", () => {
    const response = htmlResponse("ok", 200, {
      policy: shared,
      state: "HIT",
      requestId: "req-1",
      timings: { totalMs: 3.46 },
    });

    expect(response.headers.get("server-timing")).toBe('cache;desc="HIT";dur=3.5');
  });

  /**
   * The point of the split: a total says how long, the phases say which half.
   * A page whose loader dwarfs its render is a gateway problem, not a React one.
   */
  it("publishes the loader and render phases as their own metrics", () => {
    const response = htmlResponse("ok", 200, {
      policy: { kind: "none" },
      state: "BYPASS",
      timings: { totalMs: 1700, loaderMs: 1412.44, renderMs: 238.5 },
    });

    expect(response.headers.get("server-timing")).toBe(
      'cache;desc="BYPASS";dur=1700.0, loader;dur=1412.4, render;dur=238.5',
    );
  });

  it("omits a phase the response path did not measure", () => {
    const response = htmlResponse("ok", 200, { policy: { kind: "none" }, state: "BYPASS" });

    expect(response.headers.get("server-timing")).toBe('cache;desc="BYPASS"');
  });

  it("carries the caller's own headers and request id through", () => {
    const response = htmlResponse("ok", 200, {
      policy: shared,
      state: "MISS",
      headers: { "x-product": "sigorta" },
      requestId: "req-2",
    });

    expect(response.headers.get("x-product")).toBe("sigorta");
    expect(response.headers.get("x-request-id")).toBe("req-2");
    expect(response.headers.get("x-cache")).toBe("MISS");
  });
});
