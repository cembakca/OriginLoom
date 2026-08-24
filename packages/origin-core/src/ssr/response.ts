import type { LoaderResult, Route } from "@originloom/shared/lib/types";

import * as cache from "../cache/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

type CachePolicy = ReturnType<NonNullable<Route["cache"]>>;

export function htmlResponse(
  body: string | ReadableStream,
  status: number,
  policy: CachePolicy,
  state: string,
  extra?: Record<string, string>,
  requestId?: string,
  cacheDurationMs?: number,
): Response {
  const isStream = body instanceof ReadableStream;
  const headers: Record<string, string> = {
    ...extra,
    "content-type": "text/html; charset=utf-8",
    "cache-control": isStream
      ? "no-transform, no-cache, no-store, must-revalidate"
      : cache.cacheControl(policy),
    "x-cache": state,
  };
  if (requestId) headers["x-request-id"] = requestId;
  // Development only. `x-cache` is already on the response, but a script cannot
  // read its own document's headers — and a meta tag would be wrong, because a
  // cache HIT reuses a body that was rendered on a MISS. `Server-Timing` is a
  // header the browser does expose to JS, so both the state and the server-side
  // phase that produced this HTML stay fresh on every response.
  if (!config.isProduction) {
    const duration =
      cacheDurationMs !== undefined && Number.isFinite(cacheDurationMs)
        ? `;dur=${Math.max(0, cacheDurationMs).toFixed(1)}`
        : "";
    headers["server-timing"] = `cache;desc="${state}"${duration}`;
  }
  if (isStream) headers["transfer-encoding"] = "chunked";

  return new Response(body, { status, headers });
}

export function headResponse(
  status: number,
  policy: CachePolicy,
  state: string,
  extra?: Record<string, string>,
  requestId?: string,
): Response {
  const headers = new Headers({
    ...extra,
    "content-type": "text/html; charset=utf-8",
    "cache-control": cache.cacheControl(policy),
    "x-cache": state,
  });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status, headers });
}

export function loaderRedirectResponse(
  result: Extract<LoaderResult<unknown>, { kind: "redirect" }>,
  routeUrl: URL,
  requestId?: string,
): Response {
  const headers = new Headers(result.headers);
  headers.set("location", new URL(result.location, routeUrl).toString());
  headers.set("cache-control", "private, no-store");
  headers.set("x-cache", "BYPASS");
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status: result.status ?? 307, headers });
}

export function normalizeErrorStatus(status = 500): number {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError(`Route error status must be between 400 and 599: ${status}`);
  }
  return status;
}

export function logRouteOutcome(
  requestId: string | undefined,
  url: URL,
  status: number,
  cacheState: string,
  started: number,
): void {
  logRequest(requestId, {
    path: url.pathname,
    status,
    cache: cacheState,
    durationMs: Date.now() - started,
  });
}

export function logRequest(
  requestId: string | undefined,
  fields: { path: string; status: number; cache: string; durationMs: number },
): void {
  if (
    fields.status < 400 &&
    fields.cache !== "ERROR" &&
    !sampleRequestLog(requestId, config.requestLogSampleRate)
  ) {
    return;
  }
  logger.info("request", () => ({
    ...fields,
    ...(requestId !== undefined ? { requestId } : {}),
  }));
}

/** Stable sampling keeps all decisions for one request ID consistent across pods. */
export function sampleRequestLog(requestId: string | undefined, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const value = requestId ?? "missing-request-id";
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296 < rate;
}
