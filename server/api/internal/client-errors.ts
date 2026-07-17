import { config } from "@server/config";
import { logger } from "@server/logger";
import { observeClientErrorTelemetry } from "@server/metrics";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import type { Hono } from "hono";

const SOURCES = new Set([
  "island-bootstrap",
  "island-chunk-load",
  "island-module-missing",
  "island-mount",
  "island-mount-timeout",
  "island-props",
  "react-caught",
  "react-recoverable",
  "react-uncaught",
]);

type ClientErrorPayload = {
  errorId: string;
  source: string;
  message: string;
  path: string;
  island?: string;
  stack?: string;
  componentStack?: string;
};

type RateLimiter = { take(now?: number): boolean };
type IpRateLimiter = { take(clientIp: string, now?: number): boolean };

type ClientErrorApiOptions = {
  rateLimiter?: RateLimiter;
  ipRateLimiter?: IpRateLimiter;
  sampleRate?: number;
};

export class FixedWindowRateLimiter implements RateLimiter {
  private windowStartedAt: number | undefined;
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(now = Date.now()): boolean {
    if (this.windowStartedAt === undefined || now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}

export class BoundedIpRateLimiter implements IpRateLimiter {
  private readonly entries = new Map<
    string,
    { limiter: FixedWindowRateLimiter; lastSeenAt: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  take(clientIp: string, now = Date.now()): boolean {
    let entry = this.entries.get(clientIp);
    if (entry && now - entry.lastSeenAt >= this.ttlMs) {
      this.entries.delete(clientIp);
      entry = undefined;
    }
    if (!entry) {
      this.evictExpired(now);
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next();
        if (oldest.done) break;
        this.entries.delete(oldest.value);
      }
      entry = {
        limiter: new FixedWindowRateLimiter(this.limit, this.windowMs),
        lastSeenAt: now,
      };
    } else {
      this.entries.delete(clientIp);
    }
    entry.lastSeenAt = now;
    this.entries.set(clientIp, entry);
    return entry.limiter.take(now);
  }

  get size(): number {
    return this.entries.size;
  }

  private evictExpired(now: number): void {
    for (const [clientIp, entry] of this.entries) {
      if (now - entry.lastSeenAt < this.ttlMs) break;
      this.entries.delete(clientIp);
    }
  }
}

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
    const payload = await parsePayload(contextRequest(c));
    if (!payload) {
      observeClientErrorTelemetry("invalid");
      return c.json({ error: "Geçersiz telemetry payload" }, 400, {
        "cache-control": "private, no-store",
      });
    }

    if (!isSampled(payload.errorId, sampleRate)) {
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

    const sanitized = sanitizePayload(payload);
    observeClientErrorTelemetry("accepted");
    logger.warn("client runtime error", {
      requestId: c.get("requestId"),
      releaseId: config.releaseId,
      ...sanitized,
    });
    return c.body(null, 204, { "cache-control": "private, no-store" });
  });
}

async function parsePayload(request: Request): Promise<ClientErrorPayload | null> {
  let value: unknown;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) return null;
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384) return null;
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const input = value as Record<string, unknown>;
  if (!isString(input.errorId, 128) || !/^[A-Za-z0-9._-]+$/.test(input.errorId)) return null;
  if (!isString(input.source, 32) || !SOURCES.has(input.source)) return null;
  if (!isString(input.message, 500) || !isString(input.path, 1_000)) return null;
  if (!optionalString(input.island, 100)) return null;
  if (!optionalString(input.stack, 4_000)) return null;
  if (!optionalString(input.componentStack, 4_000)) return null;

  return {
    errorId: input.errorId,
    source: input.source,
    message: input.message,
    path: input.path,
    ...(typeof input.island === "string" ? { island: input.island } : {}),
    ...(typeof input.stack === "string" ? { stack: input.stack } : {}),
    ...(typeof input.componentStack === "string" ? { componentStack: input.componentStack } : {}),
  };
}

function sanitizePayload(payload: ClientErrorPayload): ClientErrorPayload {
  return {
    errorId: payload.errorId,
    source: payload.source,
    message: redactSensitive(payload.message),
    path: sanitizePath(payload.path),
    ...(payload.island ? { island: redactSensitive(payload.island) } : {}),
    ...(payload.stack ? { stack: redactSensitive(payload.stack) } : {}),
    ...(payload.componentStack ? { componentStack: redactSensitive(payload.componentStack) } : {}),
  };
}

function sanitizePath(value: string): string {
  try {
    const parsed = new URL(value, "http://client-telemetry.invalid");
    return redactSensitive(parsed.pathname).slice(0, 1_000) || "/";
  } catch {
    return redactSensitive(value.split(/[?#]/, 1)[0] || "/").slice(0, 1_000);
  }
}

export function redactSensitive(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[REDACTED_JWT]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/([?&][^=\s?#&]+=)[^&#\s]*/g, "$1[REDACTED]");
}

function isSampled(id: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296 < rate;
}

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function optionalString(value: unknown, max: number): boolean {
  return value === undefined || isString(value, max);
}
