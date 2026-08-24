import type { LoaderResult, Route } from "@originloom/shared/lib/types";

import * as cache from "../cache/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

type CachePolicy = ReturnType<NonNullable<Route["cache"]>>;

/**
 * The server-side phases of one response, in milliseconds.
 *
 * `loaderMs` and `renderMs` are sequential and therefore additive; the shell is
 * deliberately not among them, because it is started alongside the loader and
 * awaited inside the render, so its cost already shows up in whichever of the
 * two was still running when it landed. A separate shell number would overlap
 * the others and invite the wrong subtraction.
 */
export type ServerTimings = {
  /** Time to these headers — the phase the adjacent cache state describes. */
  totalMs?: number | undefined;
  /** Route loader, including every request it awaits. */
  loaderMs?: number | undefined;
  /** Document render. On a streamed route this is the shell, not the whole body. */
  renderMs?: number | undefined;
};

export type HtmlResponseOptions = {
  policy: CachePolicy;
  state: string;
  headers?: Record<string, string> | undefined;
  requestId?: string | undefined;
  timings?: ServerTimings | undefined;
};

export function htmlResponse(
  body: string | ReadableStream,
  status: number,
  options: HtmlResponseOptions,
): Response {
  const isStream = body instanceof ReadableStream;
  const headers: Record<string, string> = {
    ...options.headers,
    "content-type": "text/html; charset=utf-8",
    "cache-control": isStream
      ? "no-transform, no-cache, no-store, must-revalidate"
      : cache.cacheControl(options.policy),
    "x-cache": options.state,
  };
  if (options.requestId) headers["x-request-id"] = options.requestId;
  // Development only. `x-cache` is already on the response, but a script cannot
  // read its own document's headers — and a meta tag would be wrong, because a
  // cache HIT reuses a body that was rendered on a MISS. `Server-Timing` is a
  // header the browser does expose to JS, so the cache state and the phases
  // that produced this HTML stay fresh on every response.
  if (!config.isProduction) {
    headers["server-timing"] = serverTiming(options.state, options.timings);
  }
  if (isStream) headers["transfer-encoding"] = "chunked";

  return new Response(body, { status, headers });
}

/**
 * One metric per phase, so a browser plots them and the devtools panel can say
 * which half of a slow response was the data and which was the render. A total
 * alone answers "how long", never "why".
 */
function serverTiming(state: string, timings: ServerTimings = {}): string {
  const metrics = [`cache;desc="${state}"${duration(timings.totalMs)}`];
  if (timings.loaderMs !== undefined) metrics.push(`loader${duration(timings.loaderMs)}`);
  if (timings.renderMs !== undefined) metrics.push(`render${duration(timings.renderMs)}`);
  return metrics.join(", ");
}

function duration(ms: number | undefined): string {
  return ms !== undefined && Number.isFinite(ms) ? `;dur=${Math.max(0, ms).toFixed(1)}` : "";
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
