import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { gatewayFetch } from "../../src/lib/gateway-fetch";

describe("gatewayFetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { Authorization: init?.headers instanceof Headers ? init.headers.get("Authorization") ?? "" : "" },
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

    await gatewayFetch(request, "/user/profile");

    expect(globalThis.fetch).toHaveBeenCalled();
    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });
});
