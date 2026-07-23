import { config } from "@server/config";
import { logger } from "@server/logger";
import { observeClientErrorTelemetry } from "@server/metrics";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { productConfig } from "@server/product/config";
import {
  BoundedIpRateLimiter,
  FixedWindowRateLimiter,
  type IpRateLimiter,
  type RateLimiter,
} from "@server/security/rate-limit";
import type { Hono } from "hono";

import {
  isClientErrorSampled,
  parseClientErrorPayload,
  sanitizeClientErrorPayload,
} from "./client-errors/contract";

export { redactSensitive } from "./client-errors/contract";
export { BoundedIpRateLimiter, FixedWindowRateLimiter } from "@server/security/rate-limit";

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
