import {
  isInteger,
  isIsoDate,
  isNumber,
  isRecord,
  isString,
} from "@server/services/gateway-guards";

import type { MarketQuote, MarketQuoteBatch } from "~/lib/contracts/markets";

const MAX_QUOTES_PER_BATCH = 100;

export function parseMarketQuoteBatch(value: unknown): MarketQuoteBatch | null {
  if (
    !isRecord(value) ||
    value.type !== "quotes" ||
    !isInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER) ||
    !isIsoDate(value.asOf) ||
    !Array.isArray(value.quotes) ||
    value.quotes.length === 0 ||
    value.quotes.length > MAX_QUOTES_PER_BATCH ||
    !value.quotes.every(isMarketQuote)
  ) {
    return null;
  }
  return value as MarketQuoteBatch;
}

function isMarketQuote(value: unknown): value is MarketQuote {
  return (
    isRecord(value) &&
    isString(value.symbol, 12) &&
    /^[A-Z0-9.]+$/.test(value.symbol) &&
    isNumber(value.lastPrice, 0, 10_000_000) &&
    isNumber(value.change, -10_000_000, 10_000_000) &&
    isNumber(value.changePercent, -100, 100_000) &&
    isNumber(value.dayLow, 0, 10_000_000) &&
    isNumber(value.dayHigh, 0, 10_000_000) &&
    value.dayLow <= value.dayHigh
  );
}
