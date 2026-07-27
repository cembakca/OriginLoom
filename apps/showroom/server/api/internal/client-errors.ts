import {
  isClientErrorSampled,
  parseClientErrorPayload,
  sanitizeClientErrorPayload,
} from "@originloom/core/api/client-errors";
import { config } from "@originloom/core/config";
import { logger } from "@originloom/core/logger";
import { observeClientErrorTelemetry } from "@originloom/core/metrics";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import {
  BoundedIpRateLimiter,
  FixedWindowRateLimiter,
  type IpRateLimiter,
  type RateLimiter,
} from "@originloom/core/security/rate-limit";
import { productConfig } from "@server/product/config";
import type { Hono } from "hono";

export { redactSensitive } from "@originloom/core/api/client-errors";
export { BoundedIpRateLimiter, FixedWindowRateLimiter } from "@originloom/core/security/rate-limit";

type ClientErrorApiOptions = {
  rateLimiter?: RateLimiter;
  ipRateLimiter?: IpRateLimiter;
  sampleRate?: number;
};

const defaultGlobalRateLimiter = new FixedWindowRateLimiter(
  productConfig.clientErrorRateLimit,
  productConfig.clientErrorWindowMs,
);
const defaultIpRateLimiter = new BoundedIpRateLimiter(
  productConfig.clientErrorIpRateLimit,
  productConfig.clientErrorWindowMs,
  productConfig.clientErrorIpMaxEntries,
  productConfig.clientErrorIpTtlMs,
);

export function mountClientErrorApi(
  app: Hono<{ Variables: AppVariables }>,
  options: ClientErrorApiOptions = {},
): void {
  const globalRateLimiter = options.rateLimiter ?? defaultGlobalRateLimiter;
  const ipRateLimiter = options.ipRateLimiter ?? defaultIpRateLimiter;
  const sampleRate = options.sampleRate ?? productConfig.clientErrorSampleRate;
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
        "retry-after": String(Math.ceil(productConfig.clientErrorWindowMs / 1_000)),
      });
    }
    if (!globalRateLimiter.take()) {
      observeClientErrorTelemetry("global_rate_limited");
      observeClientErrorTelemetry("rate_limited");
      return c.body(null, 429, {
        "cache-control": "private, no-store",
        "retry-after": String(Math.ceil(productConfig.clientErrorWindowMs / 1_000)),
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
