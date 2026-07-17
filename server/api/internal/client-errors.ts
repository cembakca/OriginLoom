import { config } from "@server/config";
import { logger } from "@server/logger";
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

export function mountClientErrorApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/internal/client-errors", async (c) => {
    const payload = await parsePayload(c.req.raw);
    if (!payload) {
      return c.json({ error: "Geçersiz telemetry payload" }, 400, {
        "cache-control": "private, no-store",
      });
    }

    logger.warn("client runtime error", {
      requestId: c.get("requestId"),
      releaseId: config.releaseId,
      ...payload,
    });
    return c.body(null, 204, { "cache-control": "private, no-store" });
  });
}

async function parsePayload(request: Request): Promise<ClientErrorPayload | null> {
  let value: unknown;
  try {
    value = await request.json();
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

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function optionalString(value: unknown, max: number): boolean {
  return value === undefined || isString(value, max);
}
