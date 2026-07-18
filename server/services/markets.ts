import { gatewayFetch } from "@server/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@server/gateway-payload";
import {
  isInteger,
  isIsoDate,
  isNumber,
  isOptionalString,
  isPagination,
  isRecord,
  isString,
  isStringArray,
  MAX_COLLECTION,
} from "@server/services/gateway-guards";

import type { Stock, StockList } from "~/lib/contracts/markets";

const INVALID_MARKETS = "Markets gateway returned an invalid payload";

export async function getBist100(search: URLSearchParams, signal: AbortSignal) {
  const response = await gatewayFetch(`/markets/bist100?${search}`, { signal });
  if (!response.ok) throw new Error(`Markets gateway returned ${response.status}`);
  const payload = await readGatewayJson(response, "markets", INVALID_MARKETS);
  return requireGatewayPayload("markets", payload, isStockList, INVALID_MARKETS);
}

function isStock(value: unknown): value is Stock {
  return (
    isRecord(value) &&
    isString(value.symbol, 20) &&
    isString(value.name, 240) &&
    isString(value.sector, 120) &&
    isNumber(value.lastPrice, 0) &&
    isNumber(value.previousClose, 0) &&
    isNumber(value.change, -1_000_000, 1_000_000) &&
    isNumber(value.changePercent, -100, 100_000) &&
    isNumber(value.dayLow, 0) &&
    isNumber(value.dayHigh, 0) &&
    isNumber(value.volume, 0) &&
    isNumber(value.marketCap, 0) &&
    value.currency === "TRY"
  );
}

function isStockList(value: unknown): value is StockList {
  if (!isRecord(value) || !isRecord(value.index)) return false;
  return (
    isString(value.index.code, 20) &&
    isString(value.index.name, 120) &&
    value.index.currency === "TRY" &&
    (value.index.marketStatus === "open" || value.index.marketStatus === "closed") &&
    isIsoDate(value.index.asOf) &&
    isInteger(value.index.delayedByMinutes, 0, 1_440) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_COLLECTION &&
    value.items.every(isStock) &&
    isPagination(value.pagination) &&
    isRecord(value.query) &&
    isOptionalString(value.query.q, 120) &&
    isOptionalString(value.query.sector, 120) &&
    isString(value.query.sortBy, 80) &&
    isRecord(value.facets) &&
    isStringArray(value.facets.sectors, 100, 120) &&
    isString(value.disclaimer, 4_000)
  );
}
