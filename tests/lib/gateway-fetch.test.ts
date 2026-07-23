import { gatewayFetchForRequest } from "@originloom/core/adapters/gateway";
import { withRequestSpan } from "@originloom/core/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("gatewayFetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          Authorization:
            init?.headers instanceof Headers ? (init.headers.get("Authorization") ?? "") : "",
        },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forwards Authorization from request", async () => {
    const request = new Request("http://localhost/", {
      headers: { Authorization: "Bearer test-token" },
    });

    await gatewayFetchForRequest(request, "/user/profile");

    expect(globalThis.fetch).toHaveBeenCalled();
    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(call).toBeDefined();
    const init = call![1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("forwards the generated request ID from request context", async () => {
    const request = new Request("http://localhost/");

    await withRequestSpan(request, "generated-request-id", () =>
      gatewayFetchForRequest(request, "/user/profile"),
    );

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = call![1]!.headers as Headers;
    expect(headers.get("correlationid")).toBe("generated-request-id");
  });

  it("forwards the request abort budget to the gateway call", async () => {
    const controller = new AbortController();
    const request = new Request("http://localhost/", { signal: controller.signal });

    await gatewayFetchForRequest(request, "/user/profile");

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const signal = call![1]!.signal;
    expect(signal).toBeDefined();
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
});
