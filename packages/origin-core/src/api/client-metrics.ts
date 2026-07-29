import type { Hono } from "hono";

import { logger } from "../logger.js";
import { observeClientMetricIngestion, observeClientPerformance } from "../metrics.js";
import { contextRequest } from "../middleware/request-deadline.js";
import type { AppVariables } from "../middleware/request-id.js";
import { BoundedIpRateLimiter, FixedWindowRateLimiter } from "../security/rate-limit.js";

export type ClientMetric =
  | {
      kind: "web-vital";
      name: "CLS" | "INP" | "LCP";
      value: number;
      rating: "good" | "needs-improvement" | "poor";
      path: string;
    }
  | { kind: "island-mount"; name: string; value: number; path: string };

const globalLimit = new FixedWindowRateLimiter(600, 60_000);
const ipLimit = new BoundedIpRateLimiter(100, 60_000, 5_000, 300_000);

export function mountClientMetricApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/internal/client-metrics", async (c) => {
    const metric = await parseClientMetricPayload(contextRequest(c));
    if (!metric) {
      observeClientMetricIngestion("invalid");
      return c.body(null, 400, noStore());
    }
    if (!ipLimit.take(c.get("clientIp") ?? "unresolved") || !globalLimit.take()) {
      observeClientMetricIngestion("rate_limited");
      return c.body(null, 429, { ...noStore(), "retry-after": "60" });
    }
    observeClientMetricIngestion("accepted");
    observeClientPerformance(metric);
    // Prometheus is the durable signal. Per-event JSON is debug-only so normal
    // traffic does not serialize and write two observability records.
    logger.debug("client performance metric", () => ({
      ...metric,
      requestId: c.get("requestId"),
    }));
    return c.body(null, 204, noStore());
  });
}

export async function parseClientMetricPayload(request: Request): Promise<ClientMetric | null> {
  let input: Record<string, unknown>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 2_048) return null;
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    input = value as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Number.isFinite(input.value) || Number(input.value) < 0 || Number(input.value) > 600_000)
    return null;
  const path = sanitizePath(input.path);
  if (!path) return null;
  if (input.kind === "web-vital") {
    if (!["CLS", "INP", "LCP"].includes(String(input.name))) return null;
    if (!["good", "needs-improvement", "poor"].includes(String(input.rating))) return null;
    return {
      kind: "web-vital",
      name: input.name,
      value: Number(input.value),
      rating: input.rating,
      path,
    } as ClientMetric;
  }
  if (
    input.kind === "island-mount" &&
    typeof input.name === "string" &&
    /^[a-z0-9-]{1,100}$/.test(input.name)
  ) {
    return { kind: "island-mount", name: input.name, value: Number(input.value), path };
  }
  return null;
}

function sanitizePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_000) return null;
  try {
    return new URL(value, "http://telemetry.invalid").pathname.slice(0, 1_000);
  } catch {
    return null;
  }
}
function noStore() {
  return { "cache-control": "private, no-store" };
}
