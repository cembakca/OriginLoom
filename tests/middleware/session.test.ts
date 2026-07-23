import { createInitialResult } from "@originloom/core/middleware/sequential";
import { sessionStep } from "@originloom/core/middleware/steps/session";
import type { PipelineContext } from "@originloom/core/middleware/types";
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

  it("corrects invalid tracking ID cookie and writes it back to client", async () => {
    const request = new Request("http://localhost/test", {
      headers: { cookie: "user_tracking_id=invalid-uuid-value" },
    });
    const ctx: PipelineContext = {
      url: new URL(request.url),
      pathname: "/test",
      publicPath: "/test",
      clientIp: "127.0.0.1",
    };

    const result = await sessionStep(ctx, createInitialResult(request));
    if (!result) throw new Error("sessionStep returned no pipeline result");

    expect(result.trackingId).not.toBe("invalid-uuid-value");
    expect(result.trackingId).toMatch(/^[\da-f-]{36}$/i);

    if (!result.cookies) throw new Error("sessionStep returned no cookie mutations");
    const cookies = result.cookies.toHeaderStrings();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("user_tracking_id=");
    expect(cookies[0]).toContain(result.trackingId);
  });
});
