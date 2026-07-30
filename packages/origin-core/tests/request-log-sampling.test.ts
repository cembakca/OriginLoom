import { describe, expect, it } from "vitest";

import { sampleRequestLog } from "../src/ssr/response.js";

describe("request log sampling", () => {
  it("is deterministic and honors disabled/full boundaries", () => {
    expect(sampleRequestLog("request-1", 0)).toBe(false);
    expect(sampleRequestLog("request-1", 1)).toBe(true);
    expect(sampleRequestLog("request-1", 0.25)).toBe(sampleRequestLog("request-1", 0.25));
  });
});
