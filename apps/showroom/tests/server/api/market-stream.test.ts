import type { AppVariables } from "@originloom/core/middleware/request-id";
import { mountMarketStreamApi } from "@server/api/market-stream";
import { MarketStreamAdmission } from "@server/api/market-stream/admission";
import type { MarketQuoteHub } from "@server/services/market-stream/hub";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

function createApp(hub: MarketQuoteHub, admission = new MarketStreamAdmission(10, 2)) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("clientIp", "127.0.0.1");
    await next();
  });
  mountMarketStreamApi(app, { hub, admission });
  return app;
}

const quoteHub = (unsubscribe = vi.fn()): MarketQuoteHub => ({
  subscribe: (symbols, receive) => {
    receive({
      type: "quotes",
      sequence: 7,
      asOf: "2026-07-18T12:00:00.000Z",
      quotes: [...symbols].map((symbol) => ({
        symbol,
        lastPrice: 123.45,
        change: 1.2,
        changePercent: 0.98,
        dayLow: 120,
        dayHigh: 125,
      })),
    });
    return unsubscribe;
  },
});

describe("market stream BFF", () => {
  it("rejects cross-origin, non-SSE and malformed symbol requests", async () => {
    const app = createApp(quoteHub());
    const crossOrigin = await app.request("http://localhost/api/markets/stream?symbols=THYAO", {
      headers: { accept: "text/event-stream", origin: "https://evil.example" },
    });
    const wrongAccept = await app.request("http://localhost/api/markets/stream?symbols=THYAO");
    const invalid = await app.request(
      "http://localhost/api/markets/stream?symbols=THYAO,%0AINJECT",
      {
        headers: { accept: "text/event-stream" },
      },
    );

    expect(crossOrigin.status).toBe(403);
    expect(wrongAccept.status).toBe(406);
    expect(invalid.status).toBe(400);
  });

  it("streams validated same-origin quotes without cache or proxy buffering", async () => {
    const unsubscribe = vi.fn();
    const controller = new AbortController();
    const response = await createApp(quoteHub(unsubscribe)).request(
      "http://localhost/api/markets/stream?symbols=THYAO,AKBNK",
      { headers: { accept: "text/event-stream" }, signal: controller.signal },
    );
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("event: quotes")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    controller.abort();
    await reader.cancel();
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("private, no-store, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(text).toContain('"sequence":7');
    expect(text).toContain('"symbol":"THYAO"');
  });
});

describe("market stream admission", () => {
  it("enforces global and per-IP active connection limits and releases idempotently", () => {
    const admission = new MarketStreamAdmission(2, 1);
    const first = admission.acquire("10.0.0.1");
    const sameIp = admission.acquire("10.0.0.1");
    const second = admission.acquire("10.0.0.2");
    const global = admission.acquire("10.0.0.3");

    expect(first.kind).toBe("accepted");
    expect(sameIp.kind).toBe("ip_limit");
    expect(second.kind).toBe("accepted");
    expect(global.kind).toBe("global_limit");
    if (first.kind === "accepted") {
      first.lease.release();
      first.lease.release();
    }
    expect(admission.activeConnections).toBe(1);
    expect(admission.acquire("10.0.0.3").kind).toBe("accepted");
  });
});
