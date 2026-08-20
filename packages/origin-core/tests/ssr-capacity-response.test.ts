import { describe, expect, it } from "vitest";

import { SsrCapacityError, ssrCapacityResponse } from "../src/ssr-capacity.js";

describe("ssrCapacityResponse", () => {
  it("sets a queue-aware Retry-After for queue_full rejections", () => {
    const response = ssrCapacityResponse(new SsrCapacityError("queue_full"), "req-1");

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("x-ssr-rejection")).toBe("queue_full");
    expect(response.headers.get("x-request-id")).toBe("req-1");
  });

  it("uses a longer Retry-After when the queue wait budget expires", () => {
    const response = ssrCapacityResponse(new SsrCapacityError("wait_timeout"));

    expect(response.headers.get("retry-after")).toBe("2");
    expect(response.headers.get("x-ssr-rejection")).toBe("wait_timeout");
  });

  it("omits Retry-After when the client already aborted", () => {
    const response = ssrCapacityResponse(new SsrCapacityError("request_aborted"));

    expect(response.headers.has("retry-after")).toBe(false);
    expect(response.headers.get("x-ssr-rejection")).toBe("request_aborted");
  });
});
