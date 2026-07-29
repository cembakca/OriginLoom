import { config } from "../config.js";
import { gatewayTransportFetch } from "../gateway-transport.js";
import { observeGatewayRequest } from "../metrics.js";
import {
  activeRequestId,
  injectActiveTrace,
  SpanKind,
  SpanStatusCode,
  withSpan,
} from "../observability.js";

export function gatewayUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${config.gatewayUrl}${p}`;
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(gatewayUrl(path));
  return withSpan(
    `gateway ${init.method ?? "GET"} ${url.pathname}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": init.method ?? "GET",
        "server.address": url.hostname,
        "server.port": Number(url.port || (url.protocol === "https:" ? 443 : 80)),
        "url.path": url.pathname,
      },
    },
    async (span) => {
      const started = performance.now();
      const timeout = AbortSignal.timeout(config.gatewayTimeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      const headers = new Headers(init.headers);
      injectActiveTrace(headers);
      const requestId = activeRequestId();
      if (requestId && !headers.has("correlationid")) headers.set("correlationid", requestId);

      try {
        const response = await gatewayTransportFetch(url, { ...init, headers, signal });
        const outcome =
          response.status >= 500
            ? "server_error"
            : response.status >= 400
              ? "client_error"
              : "success";
        span.setAttribute("http.response.status_code", response.status);
        span.setAttribute("gateway.outcome", outcome);
        if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        observeGatewayRequest(response.status, performance.now() - started, outcome);
        return response;
      } catch (error) {
        const outcome = timeout.aborted || isUndiciTimeout(error) ? "timeout" : "network_error";
        span.setAttribute("gateway.outcome", outcome);
        observeGatewayRequest(0, performance.now() - started, outcome);
        throw error;
      }
    },
  );
}

/**
 * Consumes a small unused response so Undici can return its socket to the pool.
 * Oversized error bodies are cancelled instead of being buffered without limit.
 */
export async function releaseGatewayResponse(response: Response, maxBytes = 65_536): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    await reader.cancel().catch(() => undefined);
  }
}

export async function requireGatewayOk(response: Response, message: string): Promise<void> {
  if (response.ok) return;
  const status = response.status;
  await releaseGatewayResponse(response);
  throw new Error(`${message} ${status}`);
}

function isUndiciTimeout(error: unknown): boolean {
  const direct = errorCode(error);
  const cause =
    error && typeof error === "object" && "cause" in error ? errorCode(error.cause) : undefined;
  return [direct, cause].some((code) =>
    ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(
      code ?? "",
    ),
  );
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Loader/service çağrıları için request-scoped kimlik ve correlation header'larını taşır. */
export function gatewayFetchForRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const authorization = request.headers.get("authorization");
  const requestId = request.headers.get("x-request-id") ?? activeRequestId();
  if (authorization) headers.set("authorization", authorization);
  if (requestId && !headers.has("correlationid")) headers.set("correlationid", requestId);
  return gatewayFetch(path, { ...init, headers, signal: init.signal ?? request.signal });
}
