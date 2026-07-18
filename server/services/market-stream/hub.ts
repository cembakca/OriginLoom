import { logger } from "@server/logger";

import type { MarketQuoteBatch } from "~/lib/contracts/markets";

import { consumeGatewayMarketStream } from "./source";

type Listener = { symbols: ReadonlySet<string>; receive: (batch: MarketQuoteBatch) => void };

export interface MarketQuoteHub {
  subscribe(symbols: ReadonlySet<string>, receive: (batch: MarketQuoteBatch) => void): () => void;
}

class ProcessMarketQuoteHub implements MarketQuoteHub {
  private readonly listeners = new Map<number, Listener>();
  private nextId = 1;
  private deliverySequence = 0;
  private controller: AbortController | undefined;
  private running: Promise<void> | undefined;

  subscribe(symbols: ReadonlySet<string>, receive: (batch: MarketQuoteBatch) => void): () => void {
    const id = this.nextId++;
    this.listeners.set(id, { symbols, receive });
    this.start();
    return () => {
      this.listeners.delete(id);
      if (this.listeners.size === 0) this.controller?.abort();
    };
  }

  async stop(): Promise<void> {
    this.listeners.clear();
    this.controller?.abort();
    await this.running?.catch(() => undefined);
  }

  private start(): void {
    if (this.running) return;
    const controller = new AbortController();
    this.controller = controller;
    this.running = this.run(controller.signal).finally(() => {
      if (this.controller === controller) this.controller = undefined;
      this.running = undefined;
      if (this.listeners.size > 0) this.start();
    });
  }

  private async run(signal: AbortSignal): Promise<void> {
    let retryMs = 250;
    while (!signal.aborted && this.listeners.size > 0) {
      try {
        await consumeGatewayMarketStream(signal, (batch) => this.publish(batch));
        retryMs = 250;
      } catch (error) {
        if (signal.aborted) return;
        logger.warn("market stream upstream disconnected", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await abortableDelay(retryMs, signal);
      retryMs = Math.min(5_000, retryMs * 2);
    }
  }

  private publish(batch: MarketQuoteBatch): void {
    this.deliverySequence++;
    for (const listener of this.listeners.values()) {
      const quotes = batch.quotes.filter((quote) => listener.symbols.has(quote.symbol));
      if (quotes.length === 0) continue;
      listener.receive({
        type: "quotes",
        sequence: this.deliverySequence,
        asOf: batch.asOf,
        quotes,
      });
    }
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

export const marketQuoteHub = new ProcessMarketQuoteHub();

export function stopMarketQuoteHub(): Promise<void> {
  return marketQuoteHub.stop();
}
