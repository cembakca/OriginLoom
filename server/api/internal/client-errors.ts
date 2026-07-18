import { config } from "@server/config";
import { logger } from "@server/logger";
import { observeClientErrorTelemetry } from "@server/metrics";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import type { Hono } from "hono";

import {
  isClientErrorSampled,
  parseClientErrorPayload,
  sanitizeClientErrorPayload,
} from "./client-errors/contract";
import {
  BoundedIpRateLimiter,
  FixedWindowRateLimiter,
  type IpRateLimiter,
  type RateLimiter,
} from "./client-errors/rate-limit";

export { redactSensitive } from "./client-errors/contract";
export { BoundedIpRateLimiter, FixedWindowRateLimiter } from "./client-errors/rate-limit";

type ClientErrorApiOptions = {
  rateLimiter?: RateLimiter;
  ipRateLimiter?: IpRateLimiter;
  sampleRate?: number;
};

const defaultGlobalRateLimiter = new FixedWindowRateLimiter(
  config.clientErrorRateLimit,
  config.clientErrorWindowMs,
);
const defaultIpRateLimiter = new BoundedIpRateLimiter(
  config.clientErrorIpRateLimit,
  config.clientErrorWindowMs,
  config.clientErrorIpMaxEntries,
  config.clientErrorIpTtlMs,
);

export function mountClientErrorApi(
  app: Hono<{ Variables: AppVariables }>,
  options: ClientErrorApiOptions = {},
): void {
  const globalRateLimiter = options.rateLimiter ?? defaultGlobalRateLimiter;
  const ipRateLimiter = options.ipRateLimiter ?? defaultIpRateLimiter;
  const sampleRate = options.sampleRate ?? config.clientErrorSampleRate;
  app.post("/api/internal/client-errors", async (c) => {
    const payload = await parseClientErrorPayload(contextRequest(c));
    if (!payload) {
      observeClientErrorTelemetry("invalid");
      return c.json({ error: "Geçersiz telemetry payload" }, 400, {
        "cache-control": "private, no-store",
      });
    }

    if (!isClientErrorSampled(payload.errorId, sampleRate)) {
      observeClientErrorTelemetry("sampled");
      return c.body(null, 204, { "cache-control": "private, no-store" });
    }
    if (!ipRateLimiter.take(c.get("clientIp") ?? "unresolved")) {
      observeClientErrorTelemetry("ip_rate_limited");
      observeClientErrorTelemetry("rate_limited");
      return c.body(null, 429, {
        "cache-control": "private, no-store",
        "retry-after": String(Math.ceil(config.clientErrorWindowMs / 1_000)),
      });
    }
    if (!globalRateLimiter.take()) {
      observeClientErrorTelemetry("global_rate_limited");
      observeClientErrorTelemetry("rate_limited");
      return c.body(null, 429, {
        "cache-control": "private, no-store",
        "retry-after": String(Math.ceil(config.clientErrorWindowMs / 1_000)),
      });
    }

    const sanitized = sanitizeClientErrorPayload(payload);
    observeClientErrorTelemetry("accepted");
    logger.warn("client runtime error", {
      requestId: c.get("requestId"),
      releaseId: config.releaseId,
      ...sanitized,
    });
    return c.body(null, 204, { "cache-control": "private, no-store" });
  });
}
