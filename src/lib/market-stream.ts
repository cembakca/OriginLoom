import type { MarketQuote, MarketQuoteBatch } from "./contracts/markets";

const MAX_QUOTES_PER_BATCH = 100;

export function parseMarketQuoteBatch(value: unknown): MarketQuoteBatch | null {
  if (!isRecord(value) || value.type !== "quotes") return null;
  if (!integer(value.sequence, 1, Number.MAX_SAFE_INTEGER) || !isoDate(value.asOf)) return null;
  if (
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
    typeof value.symbol === "string" &&
    /^[A-Z0-9.]{1,12}$/.test(value.symbol) &&
    finite(value.lastPrice, 0, 10_000_000) &&
    finite(value.change, -10_000_000, 10_000_000) &&
    finite(value.changePercent, -100, 100_000) &&
    finite(value.dayLow, 0, 10_000_000) &&
    finite(value.dayHigh, 0, 10_000_000) &&
    value.dayLow <= value.dayHigh
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, min: number, max: number): value is number {
  return finite(value, min, max) && Number.isInteger(value);
}

function isoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}
