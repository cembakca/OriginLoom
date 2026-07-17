import { config } from "@server/config";
import { observeGatewayRequest } from "@server/metrics";
import {
  activeRequestId,
  injectActiveTrace,
  SpanKind,
  SpanStatusCode,
  withSpan,
} from "@server/observability";

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
        const response = await fetch(url, { ...init, headers, signal });
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
        const outcome = timeout.aborted ? "timeout" : "network_error";
        span.setAttribute("gateway.outcome", outcome);
        observeGatewayRequest(0, performance.now() - started, outcome);
        throw error;
      }
    },
  );
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
