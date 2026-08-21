import { describe, expect, it } from "vitest";

import {
  isClientErrorSampled,
  parseClientErrorPayload,
  sanitizeClientErrorPayload,
} from "../src/api/client-errors-contract.js";

describe("client error contract", () => {
  it("accepts market stream errors reported by the showroom island", async () => {
    const payload = await parseClientErrorPayload(
      request({
        errorId: "market-stream-123",
        source: "market-stream",
        message: "Invalid market quote event",
        path: "/markets",
      }),
    );

    expect(payload).toMatchObject({
      errorId: "market-stream-123",
      source: "market-stream",
      message: "Invalid market quote event",
    });
  });

  it("accepts an optional pageRequestId for SSR correlation", async () => {
    const payload = await parseClientErrorPayload(
      request({
        errorId: "client-123",
        source: "island-mount",
        message: "mount failed",
        path: "/catalog",
        pageRequestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171",
      }),
    );

    expect(payload).toMatchObject({
      errorId: "client-123",
      pageRequestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171",
    });
    expect(sanitizeClientErrorPayload(payload!)).toMatchObject({
      pageRequestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171",
    });
  });

  it("rejects spoofed pageRequestId values", async () => {
    const payload = await parseClientErrorPayload(
      request({
        errorId: "client-123",
        source: "island-mount",
        message: "mount failed",
        path: "/catalog",
        pageRequestId: "not a valid id",
      }),
    );
    expect(payload).toBeNull();
  });

  it("preserves deterministic sampling with pageRequestId present", () => {
    expect(isClientErrorSampled("client-123", 0.25)).toBe(isClientErrorSampled("client-123", 0.25));
  });
});

function request(body: unknown): Request {
  return new Request("http://app.test/api/internal/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
