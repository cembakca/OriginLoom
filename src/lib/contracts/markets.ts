import type { SeoInfo } from "~/lib/metadata/types";

import type { Pagination } from "./pagination";

export type Stock = {
  symbol: string;
  name: string;
  sector: string;
  lastPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayLow: number;
  dayHigh: number;
  volume: number;
  marketCap: number;
  currency: "TRY";
};

export type MarketIndex = {
  code: string;
  name: string;
  currency: "TRY";
  marketStatus: "open" | "closed";
  asOf: string;
  delayedByMinutes: number;
};

export type StockList = {
  seoInfo: SeoInfo;
  index: MarketIndex;
  items: Stock[];
  pagination: Pagination;
  query: { q: string | null; sector: string | null; sortBy: string };
  facets: { sectors: string[] };
  disclaimer: string;
};

export type MarketQuote = Pick<
  Stock,
  "symbol" | "lastPrice" | "change" | "changePercent" | "dayLow" | "dayHigh"
>;

/** Ordered server event; sequence is monotonic within one upstream connection. */
export type MarketQuoteBatch = {
  type: "quotes";
  sequence: number;
  asOf: string;
  quotes: MarketQuote[];
};
