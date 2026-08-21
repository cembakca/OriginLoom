import type { Hono } from "hono";

import { logger } from "../logger.js";
import { observeClientErrorTelemetry, observeClientRuntimeError } from "../metrics.js";
import { contextRequest } from "../middleware/request-deadline.js";
import type { AppVariables } from "../middleware/request-id.js";
import {
  BoundedIpRateLimiter,
  FixedWindowRateLimiter,
  type IpRateLimiter,
  type RateLimiter,
} from "../security/rate-limit.js";
import {
  isClientErrorSampled,
  parseClientErrorPayload,
  sanitizeClientErrorPayload,
} from "./client-errors-contract.js";

export type { ClientErrorPayload } from "./client-errors-contract.js";
export {
  isClientErrorSampled,
  parseClientErrorPayload,
  redactSensitive,
  sanitizeClientErrorPayload,
} from "./client-errors-contract.js";

export type ClientErrorApiOptions = {
  rateLimiter?: RateLimiter;
  ipRateLimiter?: IpRateLimiter;
  /** 0–1. Below 1 the endpoint drops a deterministic share of reports. */
  sampleRate?: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_GLOBAL_LIMIT = 120;
const DEFAULT_IP_LIMIT = 20;
const DEFAULT_IP_ENTRIES = 5_000;
const DEFAULT_IP_TTL_MS = 300_000;

/**
 * Receives the browser-side error reports that `reportClientError` in
 * `@originloom/shared` sends. The client half hardcodes this path, so the server
 * half belongs to the platform too — otherwise every app reinvents it, or (more
 * likely) forgets it and every client error becomes a 404 in the console.
 *
 * Untrusted input: the payload is bounded and validated, the path is stripped of
 * query values, and reports are rate limited per IP and globally.
 */
export function mountClientErrorApi(
  app: Hono<{ Variables: AppVariables }>,
  options: ClientErrorApiOptions = {},
): void {
  const globalRateLimiter =
    options.rateLimiter ?? new FixedWindowRateLimiter(DEFAULT_GLOBAL_LIMIT, DEFAULT_WINDOW_MS);
  const ipRateLimiter =
    options.ipRateLimiter ??
    new BoundedIpRateLimiter(
      DEFAULT_IP_LIMIT,
      DEFAULT_WINDOW_MS,
      DEFAULT_IP_ENTRIES,
      DEFAULT_IP_TTL_MS,
    );
  const sampleRate = options.sampleRate ?? 1;
  const noStore = { "cache-control": "private, no-store" };
  const retryAfter = String(Math.ceil(DEFAULT_WINDOW_MS / 1_000));

  app.post("/api/internal/client-errors", async (c) => {
    const payload = await parseClientErrorPayload(contextRequest(c));
    if (!payload) {
      observeClientErrorTelemetry("invalid");
      return c.body(null, 400, noStore);
    }

    if (!isClientErrorSampled(payload.errorId, sampleRate)) {
      observeClientErrorTelemetry("sampled");
      return c.body(null, 204, noStore);
    }
    if (!ipRateLimiter.take(c.get("clientIp") ?? "unresolved")) {
      observeClientErrorTelemetry("ip_rate_limited");
      observeClientErrorTelemetry("rate_limited");
      return c.body(null, 429, { ...noStore, "retry-after": retryAfter });
    }
    if (!globalRateLimiter.take()) {
      observeClientErrorTelemetry("global_rate_limited");
      observeClientErrorTelemetry("rate_limited");
      return c.body(null, 429, { ...noStore, "retry-after": retryAfter });
    }

    const sanitized = sanitizeClientErrorPayload(payload);
    observeClientErrorTelemetry("accepted");
    observeClientRuntimeError(sanitized.source);
    logger.warn("client runtime error", {
      ...sanitized,
      // Stable top-level Loki field, including when the page correlation is unavailable.
      pageRequestId: sanitized.pageRequestId ?? null,
      requestId: c.get("requestId"),
    });
    return c.body(null, 204, noStore);
  });
}
