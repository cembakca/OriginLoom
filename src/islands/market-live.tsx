import { useEffect, useState } from "react";

import { MarketLiveTable, type MarketStreamStatus } from "~/features/markets/market-live-table";
import { reportClientError } from "@originloom/react/lib/client/error-telemetry";
import type { MarketQuoteBatch, Stock } from "~/lib/contracts/markets";
import { parseMarketQuoteBatch } from "~/lib/market-stream";

type Props = { initialStocks: Stock[]; initialAsOf: string; delayedByMinutes: number };

export default function MarketLive({ initialStocks, initialAsOf, delayedByMinutes }: Props) {
  const [stocks, setStocks] = useState(initialStocks);
  const [asOf, setAsOf] = useState(initialAsOf);
  const [status, setStatus] = useState<MarketStreamStatus>("connecting");

  useEffect(() => {
    const symbols = initialStocks.map((stock) => stock.symbol).join(",");
    if (!symbols || typeof EventSource === "undefined") {
      setStatus("offline");
      return;
    }

    let source: EventSource | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;
    let lastSequence = 0;

    const scheduleReconnect = (immediate = false) => {
      source?.close();
      source = undefined;
      if (stopped || document.hidden || !navigator.onLine) return;
      setStatus("reconnecting");
      const backoff = immediate ? 250 : Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5));
      const jitter = immediate ? 0 : Math.round(Math.random() * 250);
      reconnectTimer = setTimeout(connect, backoff + jitter);
    };

    const connect = () => {
      if (stopped || document.hidden || !navigator.onLine) return;
      lastSequence = 0;
      setStatus(attempts === 0 ? "connecting" : "reconnecting");
      source = new EventSource(`/api/markets/stream?symbols=${encodeURIComponent(symbols)}`);
      source.addEventListener("ready", () => {
        attempts = 0;
        setStatus("live");
      });
      source.addEventListener("heartbeat", () => setStatus("live"));
      source.addEventListener("quotes", (event) => {
        const batch = parseEvent(event);
        if (!batch || batch.sequence <= lastSequence) return;
        lastSequence = batch.sequence;
        setStocks((current) => applyQuotes(current, batch));
        setAsOf(batch.asOf);
        setStatus("live");
      });
      source.addEventListener("rotate", () => scheduleReconnect(true));
      source.onerror = () => scheduleReconnect();
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        source?.close();
        source = undefined;
        setStatus("paused");
      } else {
        attempts = 0;
        connect();
      }
    };
    const onOffline = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      source = undefined;
      setStatus("offline");
    };
    const onOnline = () => {
      attempts = 0;
      connect();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [initialStocks]);

  return (
    <MarketLiveTable
      stocks={stocks}
      asOf={asOf}
      delayedByMinutes={delayedByMinutes}
      status={status}
    />
  );
}

function parseEvent(event: Event): MarketQuoteBatch | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  try {
    const batch = parseMarketQuoteBatch(JSON.parse(event.data));
    if (!batch) reportClientError("market-stream", new Error("Invalid market quote event"));
    return batch;
  } catch (error) {
    reportClientError("market-stream", error);
    return null;
  }
}

function applyQuotes(stocks: Stock[], batch: MarketQuoteBatch): Stock[] {
  const quotes = new Map(batch.quotes.map((quote) => [quote.symbol, quote]));
  return stocks.map((stock) => {
    const quote = quotes.get(stock.symbol);
    return quote ? { ...stock, ...quote } : stock;
  });
}
