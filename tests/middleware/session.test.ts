import { createInitialResult } from "@server/middleware/sequential";
import { sessionStep } from "@server/middleware/steps/session";
import type { PipelineContext } from "@server/middleware/types";
import { describe, expect, it } from "vitest";

describe("session response isolation", () => {
  it("keeps the tracking id in request context and out of response headers", async () => {
    const request = new Request("http://localhost/test", {
      headers: { cookie: "user_tracking_id=11111111-1111-4111-8111-111111111111" },
    });
    const ctx: PipelineContext = {
      url: new URL(request.url),
      pathname: "/test",
      publicPath: "/test",
      clientIp: "127.0.0.1",
    };

    const result = await sessionStep(ctx, createInitialResult(request));

    expect(result?.trackingId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result?.responseHeaders?.has("x-tracking-id") ?? false).toBe(false);
    expect(result?.request?.headers.get("x-pathname")).toBe("/test");
  });
});
