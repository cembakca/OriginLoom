import { timingSafeEqual } from "node:crypto";

import { bist100Stocks } from "../data/market.js";

const DEFAULT_TOKEN = "dev-market-stream-token";
const MAX_SYMBOLS = 100;
const TICK_MS = 1_000;
const symbolPattern = /^[A-Z0-9.]{1,12}$/;

export function resolveMarketStreamRequest(request, response, url) {
  if (request.method !== "GET" || url.pathname !== "/internal/markets/stream") return false;
  if (!authorized(request.headers.authorization)) {
    json(response, 401, { error: "unauthorized market stream" });
    return true;
  }

  const symbols = requestedSymbols(url.searchParams.get("symbols"));
  if (!symbols) {
    json(response, 400, { error: "invalid market symbols" });
    return true;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "private, no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();

  let sequence = 0;
  const send = () => {
    sequence++;
    const event = quoteBatch(symbols, sequence);
    response.write(`id: ${sequence}\nevent: quotes\ndata: ${JSON.stringify(event)}\n\n`);
  };
  send();
  const timer = setInterval(send, TICK_MS);
  timer.unref?.();

  const close = () => clearInterval(timer);
  request.once("close", close);
  response.once("close", close);
  return true;
}

function requestedSymbols(raw) {
  const available = new Map(bist100Stocks.map((stock) => [stock.symbol, stock]));
  const values = raw
    ? [
        ...new Set(
          raw
            .split(",")
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean),
        ),
      ]
    : [...available.keys()];
  if (
    values.length === 0 ||
    values.length > MAX_SYMBOLS ||
    values.some((value) => !symbolPattern.test(value) || !available.has(value))
  ) {
    return null;
  }
  return values.map((symbol) => available.get(symbol));
}

function quoteBatch(stocks, sequence) {
  const asOf = new Date().toISOString();
  return {
    type: "quotes",
    sequence,
    asOf,
    quotes: stocks.map((stock, index) => {
      const movement = Math.sin(sequence / 2 + index) * Math.max(0.01, stock.lastPrice * 0.0015);
      const lastPrice = rounded(Math.max(0.01, stock.lastPrice + movement));
      const change = rounded(lastPrice - stock.previousClose);
      const changePercent = rounded((change / stock.previousClose) * 100);
      return {
        symbol: stock.symbol,
        lastPrice,
        change,
        changePercent,
        dayLow: rounded(Math.min(stock.dayLow, lastPrice)),
        dayHigh: rounded(Math.max(stock.dayHigh, lastPrice)),
      };
    }),
  };
}

function authorized(header) {
  const expected = process.env.MARKET_STREAM_TOKEN || DEFAULT_TOKEN;
  const actual = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function rounded(value) {
  return Number(value.toFixed(2));
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
  });
  response.end(JSON.stringify(body));
}
