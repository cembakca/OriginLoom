// @vitest-environment jsdom

import { reportClientError } from "@originloom/shared/lib/client/error-telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client error telemetry", () => {
  it("reports a sanitized same-origin payload without throwing", async () => {
    window.history.replaceState({}, "", "/bilgi-merkezi?page=2");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const errorId = reportClientError("react-recoverable", new Error("hydration mismatch"), {
      island: "blog-pagination",
      componentStack: "at BlogPagination",
    });

    expect(errorId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/internal/client-errors");
    expect(init).toMatchObject({ method: "POST", credentials: "omit", keepalive: true });
    expect(typeof init.body).toBe("string");
    const body = typeof init.body === "string" ? init.body : "{}";
    expect(JSON.parse(body)).toMatchObject({
      errorId,
      source: "react-recoverable",
      message: "hydration mismatch",
      island: "blog-pagination",
      componentStack: "at BlogPagination",
      path: "/bilgi-merkezi",
    });
  });

  it("swallows telemetry transport failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() => reportClientError("island-mount", "module missing")).not.toThrow();
    await Promise.resolve();
  });
});
