import {
  readEmbeddedRequestContext,
} from "./request-context.js";

export type ClientErrorSource =
  | "island-bootstrap"
  | "island-chunk-load"
  | "island-module-missing"
  | "island-mount"
  | "island-mount-timeout"
  | "island-props"
  | "market-stream"
  | "performance-telemetry"
  | "react-caught"
  | "react-recoverable"
  | "react-uncaught";

export type ClientErrorContext = {
  island?: string;
  componentStack?: string | null | undefined;
};

const MAX_MESSAGE = 500;
const MAX_STACK = 4_000;
const MAX_COMPONENT_STACK = 4_000;

let loggedPageRequestId = false;

type ClientImportMeta = ImportMeta & { env?: { DEV?: boolean } };

function isDevClient(): boolean {
  if (typeof import.meta === "undefined") return false;
  return Boolean((import.meta as ClientImportMeta).env?.DEV);
}

/** Logs the SSR page request id once in development for terminal correlation. */
export function logPageRequestIdInDev(): void {
  if (!isDevClient() || loggedPageRequestId || typeof document === "undefined") return;
  loggedPageRequestId = true;
  const { pageRequestId } = readEmbeddedRequestContext();
  if (pageRequestId) {
    console.info(`[origin] page requestId ${pageRequestId}`);
  }
}

/** Best-effort reporting. Telemetry failure must never break island mounting. */
export function reportClientError(
  source: ClientErrorSource,
  error: unknown,
  context: ClientErrorContext = {},
): string {
  logPageRequestIdInDev();
  const errorId = createErrorId();
  const normalized = normalizeError(error);
  const pageRequestId = readEmbeddedRequestContext().pageRequestId;
  const payload = {
    errorId,
    source,
    message: truncate(normalized.message, MAX_MESSAGE),
    ...(normalized.stack ? { stack: truncate(normalized.stack, MAX_STACK) } : {}),
    ...(context.island ? { island: truncate(context.island, 100) } : {}),
    ...(context.componentStack
      ? { componentStack: truncate(context.componentStack, MAX_COMPONENT_STACK) }
      : {}),
    ...(pageRequestId ? { pageRequestId } : {}),
    // Query values may contain search terms, identifiers or tokens; server strips them again.
    path: window.location.pathname.slice(0, 1_000),
  };

  void fetch("/api/internal/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "omit",
    keepalive: true,
  }).catch(() => undefined);

  if (isDevClient()) {
    const pageHint = pageRequestId ? ` pageRequestId=${pageRequestId}` : "";
    console.warn(`[origin] client error errorId=${errorId}${pageHint} source=${source}`);
  }

  return errorId;
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error) };
}

function createErrorId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
