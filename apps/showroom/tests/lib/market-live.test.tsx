/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MarketLive from "~/islands/market-live";
import type { Stock } from "~/lib/contracts/markets";

const stock: Stock = {
  symbol: "THYAO",
  name: "Türk Hava Yolları",
  sector: "Ulaştırma",
  lastPrice: 300,
  previousClose: 298,
  change: 2,
  changePercent: 0.67,
  dayLow: 295,
  dayHigh: 305,
  volume: 1_000_000,
  marketCap: 400_000_000_000,
  currency: "TRY",
};

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();

  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
}

let root: Root | undefined;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("live market island", () => {
  it("keeps the SSR snapshot visible and applies validated quote events in place", async () => {
    root = createRoot(document.querySelector("#root")!);
    act(() =>
      root!.render(
        <MarketLive
          initialStocks={[stock]}
          initialAsOf="2026-07-18T12:00:00.000Z"
          delayedByMinutes={15}
        />,
      ),
    );
    const source = FakeEventSource.instances[0]!;

    expect(source.url).toBe("/api/markets/stream?symbols=THYAO");
    expect(document.querySelector("[data-market-price]")?.textContent).toContain("300");

    act(() => {
      source.dispatchEvent(new Event("ready"));
      source.dispatchEvent(
        new MessageEvent("quotes", {
          data: JSON.stringify({
            type: "quotes",
            sequence: 1,
            asOf: "2026-07-18T12:00:01.000Z",
            quotes: [
              {
                symbol: "THYAO",
                lastPrice: 301.5,
                change: 3.5,
                changePercent: 1.17,
                dayLow: 295,
                dayHigh: 305,
              },
            ],
          }),
        }),
      );
    });

    expect(document.body.textContent).toContain("Canlı akış bağlı");
    expect(document.querySelector("[data-market-price]")?.textContent).toContain("301,5");
    expect(document.querySelector("[data-market-change]")?.textContent).toContain("+1,17%");
  });
});
