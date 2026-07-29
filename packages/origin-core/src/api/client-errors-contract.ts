const SOURCES = new Set([
  "island-bootstrap",
  "island-chunk-load",
  "island-module-missing",
  "island-mount",
  "island-mount-timeout",
  "island-props",
  "performance-telemetry",
  "react-caught",
  "react-recoverable",
  "react-uncaught",
]);

export type ClientErrorPayload = {
  errorId: string;
  source: string;
  message: string;
  path: string;
  island?: string;
  stack?: string;
  componentStack?: string;
};

export async function parseClientErrorPayload(
  request: Request,
): Promise<ClientErrorPayload | null> {
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

export function sanitizeClientErrorPayload(payload: ClientErrorPayload): ClientErrorPayload {
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

export function redactSensitive(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[REDACTED_JWT]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/([?&][^=\s?#&]+=)[^&#\s]*/g, "$1[REDACTED]");
}

export function isClientErrorSampled(id: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296 < rate;
}

function sanitizePath(value: string): string {
  try {
    const parsed = new URL(value, "http://client-telemetry.invalid");
    return redactSensitive(parsed.pathname).slice(0, 1_000) || "/";
  } catch {
    return redactSensitive(value.split(/[?#]/, 1)[0] || "/").slice(0, 1_000);
  }
}

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function optionalString(value: unknown, max: number): boolean {
  return value === undefined || isString(value, max);
}
