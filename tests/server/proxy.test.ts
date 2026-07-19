import { proxyRequest } from "@server/proxy";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("external rewrite proxy boundary", () => {
  it("forwards only explicitly safe request headers", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(
        new Response("ok", {
          headers: {
            "content-type": "text/plain",
            "set-cookie": "access_token=upstream; HttpOnly",
            "x-internal-debug": "secret",
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyRequest(
      new Request("https://www.example.com/public", {
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-secret",
          cookie: "access_token=browser-secret; tracking_id=track",
          origin: "https://attacker.example",
          "x-forwarded-for": "203.0.113.99",
          "x-request-id": "attacker-controlled",
        },
      }),
      "https://gateway.example.com/public",
      "198.51.100.20",
    );

    const upstreamHeaders = new Headers(capturedInit?.headers);
    expect(upstreamHeaders.get("accept")).toBe("application/json");
    expect(upstreamHeaders.get("x-client-ip")).toBe("198.51.100.20");
    expect(upstreamHeaders.has("authorization")).toBe(false);
    expect(upstreamHeaders.has("cookie")).toBe(false);
    expect(upstreamHeaders.has("origin")).toBe(false);
    expect(upstreamHeaders.has("x-forwarded-for")).toBe(false);
    expect(upstreamHeaders.has("x-request-id")).toBe(false);

    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("x-internal-debug")).toBe(false);
  });
});
