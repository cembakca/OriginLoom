import { describe, expect, it } from "vitest";

import { htmlResponse } from "../src/ssr/response.js";

describe("HTML Server-Timing", () => {
  it("keeps cache state and its server-side duration on the same metric", () => {
    const response = htmlResponse(
      "ok",
      200,
      { kind: "shared", ttl: 60, key: ["home"] },
      "HIT",
      undefined,
      "req-1",
      3.46,
    );

    expect(response.headers.get("server-timing")).toBe('cache;desc="HIT";dur=3.5');
  });

  it("omits duration when the response path did not measure one", () => {
    const response = htmlResponse("ok", 200, { kind: "none" }, "BYPASS");

    expect(response.headers.get("server-timing")).toBe('cache;desc="BYPASS"');
  });
});
