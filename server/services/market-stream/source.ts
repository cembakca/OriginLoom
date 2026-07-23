import { gatewayUrl } from "@server/adapters/gateway";
import { config } from "@server/config";
import { observeMarketStreamEvent } from "@server/metrics/market-stream";
import { productConfig } from "@server/product/config";

import type { MarketQuoteBatch } from "~/lib/contracts/markets";
import { parseMarketQuoteBatch } from "~/lib/market-stream";

const MAX_SSE_BUFFER_BYTES = 128 * 1024;
const MAX_INVALID_EVENTS = 5;

export async function consumeGatewayMarketStream(
  signal: AbortSignal,
  onBatch: (batch: MarketQuoteBatch) => void,
): Promise<void> {
  const handshake = new AbortController();
  const timer = setTimeout(
    () => handshake.abort(new Error("Market stream handshake timed out")),
    config.gatewayTimeoutMs,
  );
  timer.unref?.();

  let response: Response;
  try {
    response = await fetch(gatewayUrl("/internal/markets/stream"), {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${productConfig.marketStreamToken}`,
      },
      signal: AbortSignal.any([signal, handshake.signal]),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Market stream gateway returned ${response.status}`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("Market stream gateway returned an invalid content type");
  }

  await consumeSseBody(response.body, signal, onBatch);
}

async function consumeSseBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onBatch: (batch: MarketQuoteBatch) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let invalidEvents = 0;
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (Buffer.byteLength(buffer) > MAX_SSE_BUFFER_BYTES) {
        throw new Error("Market stream frame exceeded the buffer limit");
      }

      let frame: string | null;
      while (
        (frame = takeFrame(
          () => buffer,
          (next) => (buffer = next),
        ))
      ) {
        const batch = parseFrame(frame);
        if (!batch) {
          observeMarketStreamEvent("invalid");
          invalidEvents++;
          if (invalidEvents >= MAX_INVALID_EVENTS) {
            throw new Error("Market stream returned repeated invalid events");
          }
          continue;
        }
        invalidEvents = 0;
        onBatch(batch);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function takeFrame(get: () => string, set: (value: string) => void): string | null {
  const buffer = get();
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  if (!match || match.index === undefined) return null;
  const frame = buffer.slice(0, match.index);
  set(buffer.slice(match.index + match[0].length));
  return frame;
}

function parseFrame(frame: string): MarketQuoteBatch | null {
  const data = frame
    .split(/\r\n|\r|\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return parseMarketQuoteBatch(JSON.parse(data));
  } catch {
    return null;
  }
}
