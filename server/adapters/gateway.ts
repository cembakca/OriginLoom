import { config } from "@server/config";
import { observeGatewayRequest } from "@server/metrics";

export function gatewayUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${config.gatewayUrl}${p}`;
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(config.gatewayTimeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  try {
    const response = await fetch(gatewayUrl(path), { ...init, signal });
    observeGatewayRequest(response.status, performance.now() - started);
    return response;
  } catch (error) {
    observeGatewayRequest(0, performance.now() - started);
    throw error;
  }
}

/** Loader/service çağrıları için request-scoped kimlik ve correlation header'larını taşır. */
export function gatewayFetchForRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const authorization = request.headers.get("authorization");
  const requestId = request.headers.get("x-request-id");
  if (authorization) headers.set("authorization", authorization);
  if (requestId && !headers.has("correlationid")) headers.set("correlationid", requestId);
  return gatewayFetch(path, { ...init, headers });
}
