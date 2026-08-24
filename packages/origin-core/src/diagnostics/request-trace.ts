import { logger } from "../logger.js";
import { activeRequestId } from "../observability.js";

/**
 * Opt-in request tracing for the times a page is slow or failing in an
 * environment you cannot attach a debugger to.
 *
 * Platform code, not app code. It was generated into every application once,
 * which meant every application owned a copy that could rot on its own — and
 * two of them had already drifted into different behaviour. Nothing in here is
 * about any particular product: it reads the request id the platform mints and
 * writes to the platform logger.
 *
 * Off unless `SSR_DIAGNOSTICS=1`, and when off every function here returns
 * before doing any work — the tracking map stays empty, so this costs nothing
 * in production until the day you turn it on.
 */
export const SSR_DIAGNOSTICS_ENABLED =
  process.env.SSR_DIAGNOSTICS === "1" || process.env.SSR_DIAGNOSTICS === "true";

const SLOW_REQUEST_MS = Number(process.env.SSR_DIAGNOSTICS_SLOW_MS ?? 750);
/** A request that never reports an outcome must not pin its entry forever. */
const MAX_TRACKED_REQUESTS = 2_048;

export type UpstreamCallRecord = {
  url: string;
  method: string;
  status: number;
  durationMs: number;
  cached?: boolean;
  error?: string;
};

type TrackedRequest = {
  pagePath?: string;
  startedAt: number;
  upstream: UpstreamCallRecord[];
};

const tracked = new Map<string, TrackedRequest>();

/**
 * The id the platform assigned this request, from the async context it keeps
 * for the duration of the request.
 *
 * Reading the inbound `x-request-id` header instead would only work behind a
 * proxy that sets one: the platform mints its own when the header is absent,
 * which is every local run and most deployments. That mistake is silent —
 * nothing is ever tracked, and the trace comes out empty rather than missing.
 */
function currentRequestId(): string | undefined {
  return activeRequestId();
}

function ensureTracked(requestId: string): TrackedRequest {
  let entry = tracked.get(requestId);
  if (!entry) {
    if (tracked.size >= MAX_TRACKED_REQUESTS) {
      const oldest = tracked.keys().next().value;
      if (oldest !== undefined) tracked.delete(oldest);
    }
    entry = { startedAt: performance.now(), upstream: [] };
    tracked.set(requestId, entry);
  }
  return entry;
}

/** Names the page a request id belongs to, so the log line is readable. */
export function bindRequestPath(pagePath: string): void {
  if (!SSR_DIAGNOSTICS_ENABLED) return;
  const requestId = currentRequestId();
  if (!requestId) return;
  ensureTracked(requestId).pagePath = pagePath;
}

export function recordUpstreamCall(record: UpstreamCallRecord): void {
  if (!SSR_DIAGNOSTICS_ENABLED) return;
  const requestId = currentRequestId();
  if (!requestId) return;
  ensureTracked(requestId).upstream.push(record);
}

/**
 * Closes out a request. Only failures and slow requests are logged — a healthy
 * fast page would otherwise bury them — and the entry is dropped either way.
 *
 * The id comes off the response, not the async context: this runs after the
 * request has finished, where that context is already gone. The platform's
 * request-id middleware stamps `x-request-id` on the way out, which is what
 * ties the outcome back to the calls recorded during the render.
 */
export function logSsrOutcome(opts: {
  request: Request;
  response?: Response | undefined;
  pageStatus: number;
  errorType?: string | undefined;
  errorMessage?: string | undefined;
}): void {
  if (!SSR_DIAGNOSTICS_ENABLED) return;

  // The same id the calls were recorded under, and for the same reason the
  // comment above `currentRequestId` gives: the header exists only behind a
  // proxy that sets one, while the platform always has an id in async context.
  // Reading only the header made the lookup miss every time the header was
  // absent — the entry stayed in the map and the trace came out empty, which is
  // indistinguishable from "nothing happened".
  const requestId =
    opts.response?.headers.get("x-request-id") ??
    opts.request.headers.get("x-request-id") ??
    currentRequestId();
  const entry = requestId ? tracked.get(requestId) : undefined;
  const durationMs = entry ? performance.now() - entry.startedAt : undefined;
  const pagePath = entry?.pagePath ?? new URL(opts.request.url).pathname;
  const isFailure = opts.pageStatus >= 400;
  const isSlow = durationMs !== undefined && durationMs >= SLOW_REQUEST_MS;

  if (requestId) tracked.delete(requestId);
  if (!isFailure && !isSlow) return;

  const upstream = entry?.upstream ?? [];
  const payload = {
    page: pagePath,
    pageStatus: opts.pageStatus,
    requestId: requestId ?? "unknown",
    durationMs: durationMs === undefined ? undefined : Math.round(durationMs),
    errorType: opts.errorType,
    errorMessage: opts.errorMessage,
    upstreamCount: upstream.length,
    upstream: upstream.length
      ? upstream.map(
          (call) =>
            `${call.method} ${call.url} => ${call.status}${call.cached ? " (cached)" : ""} / ${call.durationMs.toFixed(0)}ms${call.error ? ` err=${call.error}` : ""}`,
        )
      : undefined,
  };

  if (isFailure) logger.error("ssr request failed", payload);
  else logger.warn("ssr request slow", payload);
}

/** Turns an upstream status into a stable, greppable label. */
export function classifyGatewayError(status: number): string {
  if (status === 429) return "UPSTREAM_RATE_LIMIT";
  if (status === 503) return "UPSTREAM_UNAVAILABLE";
  if (status === 502) return "UPSTREAM_BAD_GATEWAY";
  if (status === 504) return "UPSTREAM_TIMEOUT";
  if (status >= 500) return "UPSTREAM_5XX";
  if (status >= 400) return "UPSTREAM_4XX";
  return "UPSTREAM_ERROR";
}
