import { describe, expect, it } from "vitest";

import { parseMarketQuoteBatch } from "~/lib/market-stream";

const valid = {
  type: "quotes",
  sequence: 1,
  asOf: "2026-07-18T12:00:00.000Z",
  quotes: [
    {
      symbol: "THYAO",
      lastPrice: 300,
      change: 2,
      changePercent: 0.67,
      dayLow: 295,
      dayHigh: 305,
    },
  ],
};

describe("market stream contract", () => {
  it("accepts bounded quote batches", () => {
    expect(parseMarketQuoteBatch(valid)).toEqual(valid);
  });

  it("rejects invalid symbols, order and non-finite prices", () => {
    expect(
      parseMarketQuoteBatch({
        ...valid,
        quotes: [{ ...valid.quotes[0], symbol: "THYAO\nINJECT" }],
      }),
    ).toBeNull();
    expect(
      parseMarketQuoteBatch({
        ...valid,
        quotes: [{ ...valid.quotes[0], dayLow: 400, dayHigh: 300 }],
      }),
    ).toBeNull();
    expect(
      parseMarketQuoteBatch({
        ...valid,
        quotes: [{ ...valid.quotes[0], lastPrice: Number.POSITIVE_INFINITY }],
      }),
    ).toBeNull();
  });
});
