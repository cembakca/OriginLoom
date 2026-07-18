import { config } from "@server/config";
import {
  observeMarketStreamConnection,
  observeMarketStreamEvent,
  setMarketStreamActiveConnections,
} from "@server/metrics/market-stream";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { type MarketQuoteHub, marketQuoteHub } from "@server/services/market-stream/hub";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { MarketQuoteBatch } from "~/lib/contracts/markets";

import { MarketStreamAdmission } from "./admission";

const symbolPattern = /^[A-Z0-9.]{1,12}$/;
const defaultAdmission = new MarketStreamAdmission(
  config.marketStreamMaxConnections,
  config.marketStreamMaxConnectionsPerIp,
);
const shutdownController = new AbortController();

type MarketStreamOptions = {
  hub?: MarketQuoteHub;
  admission?: MarketStreamAdmission;
};

export function mountMarketStreamApi(
  app: Hono<{ Variables: AppVariables }>,
  options: MarketStreamOptions = {},
): void {
  const hub = options.hub ?? marketQuoteHub;
  const admission = options.admission ?? defaultAdmission;

  app.get("/api/markets/stream", (c) => {
    c.set("requestRoute", "/api/markets/stream");
    return handleMarketStream(c, hub, admission);
  });
}

function handleMarketStream(
  c: Context<{ Variables: AppVariables }>,
  hub: MarketQuoteHub,
  admission: MarketStreamAdmission,
): Response {
  const request = contextRequest(c);
  const securityError = validateBrowserRequest(request);
  if (securityError) {
    observeMarketStreamConnection("invalid_request");
    return securityError;
  }

  const symbols = parseSymbols(new URL(request.url).searchParams.get("symbols"));
  if (!symbols) {
    observeMarketStreamConnection("invalid_request");
    return errorResponse("Geçersiz piyasa sembolleri", 400);
  }

  const admitted = admission.acquire(c.get("clientIp") ?? "unknown");
  if (admitted.kind !== "accepted") {
    observeMarketStreamConnection(admitted.kind === "ip_limit" ? "ip_limited" : "global_limited");
    return errorResponse("Canlı piyasa bağlantı limiti aşıldı", 429, { "retry-after": "15" });
  }
  observeMarketStreamConnection("accepted");
  setMarketStreamActiveConnections(admission.activeConnections);

  const response = streamSSE(c, async (stream) => {
    const inbox = new LatestBatchInbox();
    const unsubscribe = hub.subscribe(symbols, (batch) => inbox.push(batch));
    stream.onAbort(() => inbox.close());
    const onRequestAbort = () => inbox.close();
    const onShutdown = () => inbox.close();
    request.signal.addEventListener("abort", onRequestAbort, { once: true });
    shutdownController.signal.addEventListener("abort", onShutdown, { once: true });
    const expiresAt = Date.now() + config.marketStreamMaxDurationMs;

    try {
      await stream.writeSSE({
        event: "ready",
        retry: 2_000,
        data: JSON.stringify({ connected: true, symbols: [...symbols] }),
      });
      while (
        !stream.aborted &&
        !request.signal.aborted &&
        !shutdownController.signal.aborted &&
        Date.now() < expiresAt
      ) {
        const waitMs = Math.min(
          config.marketStreamHeartbeatMs,
          Math.max(1, expiresAt - Date.now()),
        );
        const batch = await inbox.next(waitMs);
        if (stream.aborted) break;
        if (batch) {
          await stream.writeSSE({
            event: "quotes",
            id: String(batch.sequence),
            data: JSON.stringify(batch),
          });
        } else {
          await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
        }
      }
      if (!stream.aborted && !request.signal.aborted && !shutdownController.signal.aborted) {
        await stream.writeSSE({ event: "rotate", data: "reconnect" });
      }
    } finally {
      request.signal.removeEventListener("abort", onRequestAbort);
      shutdownController.signal.removeEventListener("abort", onShutdown);
      inbox.close();
      unsubscribe();
      admitted.lease.release();
      observeMarketStreamConnection("closed");
      setMarketStreamActiveConnections(admission.activeConnections);
    }
  });

  response.headers.set("cache-control", "private, no-store, no-transform");
  response.headers.set("x-accel-buffering", "no");
  response.headers.set("vary", "Accept");
  return response;
}

export function stopMarketStreamClients(): void {
  shutdownController.abort();
}

function validateBrowserRequest(request: Request): Response | null {
  if (!request.headers.get("accept")?.toLowerCase().includes("text/event-stream")) {
    return errorResponse("SSE Accept header zorunludur", 406);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return errorResponse("Cross-site piyasa akışı reddedildi", 403);
  }
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    return new URL(origin).origin === new URL(config.siteUrl).origin
      ? null
      : errorResponse("Cross-origin piyasa akışı reddedildi", 403);
  } catch {
    return errorResponse("Geçersiz Origin", 403);
  }
}

function parseSymbols(raw: string | null): ReadonlySet<string> | null {
  if (!raw || raw.length > config.marketStreamMaxSymbols * 13) return null;
  const symbols = new Set(raw.split(","));
  if (
    symbols.size === 0 ||
    symbols.size > config.marketStreamMaxSymbols ||
    [...symbols].some((symbol) => !symbolPattern.test(symbol))
  ) {
    return null;
  }
  return symbols;
}

function errorResponse(message: string, status: number, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

class LatestBatchInbox {
  private latest: MarketQuoteBatch | undefined;
  private waiter: ((batch: MarketQuoteBatch | null) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  push(batch: MarketQuoteBatch): void {
    if (this.closed) return;
    if (!this.waiter) {
      if (this.latest) observeMarketStreamEvent("coalesced");
      this.latest = batch;
      return;
    }
    const waiter = this.takeWaiter();
    waiter?.(batch);
  }

  next(timeoutMs: number): Promise<MarketQuoteBatch | null> {
    if (this.latest) {
      const batch = this.latest;
      this.latest = undefined;
      return Promise.resolve(batch);
    }
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiter = resolve;
      this.timer = setTimeout(() => this.takeWaiter()?.(null), timeoutMs);
      this.timer.unref?.();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.latest = undefined;
    this.takeWaiter()?.(null);
  }

  private takeWaiter(): ((batch: MarketQuoteBatch | null) => void) | undefined {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const waiter = this.waiter;
    this.waiter = undefined;
    return waiter;
  }
}
