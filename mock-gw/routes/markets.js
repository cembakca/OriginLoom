import { bist100Stocks } from "../data/market.js";
import {
  enumParam,
  matchesQuery,
  normalizedQuery,
  paginate,
  parsePage,
  parsePageSize,
} from "../lib/query.js";

const sortOrders = new Set([
  "symbol-asc",
  "price-desc",
  "change-desc",
  "change-asc",
  "market-cap-desc",
]);

export function resolveMarketsRequest(request, url) {
  if (request.method !== "GET" || url.pathname !== "/markets/bist100") return null;
  const query = normalizedQuery(url.searchParams.get("q"));
  const sector = normalizedQuery(url.searchParams.get("sector"));
  const sortBy = enumParam(url.searchParams, "sortBy", sortOrders, "market-cap-desc");
  const stocks = bist100Stocks
    .filter((item) => !sector || item.sector.toLocaleLowerCase("tr-TR") === sector)
    .filter((item) => matchesQuery(query, item.symbol, item.name, item.sector));
  sortStocks(stocks, sortBy);
  return {
    status: 200,
    body: {
      index: {
        code: "XU100",
        name: "BIST 100",
        currency: "TRY",
        marketStatus: marketStatus(),
        asOf: new Date().toISOString(),
        delayedByMinutes: 15,
      },
      ...paginate(stocks, parsePage(url.searchParams), parsePageSize(url.searchParams, 10)),
      query: { q: query || null, sector: sector || null, sortBy },
      facets: { sectors: [...new Set(bist100Stocks.map((item) => item.sector))].sort() },
      disclaimer:
        "Veriler örnek amaçlı ve 15 dakika gecikmeli kabul edilmelidir; yatırım tavsiyesi değildir.",
    },
  };
}

function sortStocks(stocks, sortBy) {
  if (sortBy === "symbol-asc") stocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
  else if (sortBy === "price-desc") stocks.sort((a, b) => b.lastPrice - a.lastPrice);
  else if (sortBy === "change-desc") stocks.sort((a, b) => b.changePercent - a.changePercent);
  else if (sortBy === "change-asc") stocks.sort((a, b) => a.changePercent - b.changePercent);
  else stocks.sort((a, b) => b.marketCap - a.marketCap);
}

function marketStatus() {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    weekday: "short",
  }).format(now);
  return !["Sat", "Sun"].includes(weekday) && hour >= 10 && hour < 18 ? "open" : "closed";
}
