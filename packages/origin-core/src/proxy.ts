import { config } from "./config.js";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "range",
  "user-agent",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "age",
  "cache-control",
  "content-disposition",
  "content-language",
  "content-range",
  "content-type",
  "date",
  "etag",
  "expires",
  "last-modified",
  "location",
  "retry-after",
  "vary",
  "www-authenticate",
] as const;

function pickHeaders(input: Headers, names: readonly string[]): Headers {
  const headers = new Headers();
  for (const name of names) {
    const value = input.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

/** Forward request to the configured gateway/CDN rewrite target. */
export async function proxyRequest(
  request: Request,
  targetUrl: string,
  clientIp?: string,
): Promise<Response> {
  const url = new URL(targetUrl);
  const headers = pickHeaders(request.headers, FORWARDED_REQUEST_HEADERS);
  if (clientIp) headers.set("x-client-ip", clientIp);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(config.gatewayTimeoutMs)]),
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // @ts-expect-error — required for streaming body in Node 22
    init.duplex = "half";
  }

  const upstream = await fetch(url, init);
  const responseHeaders = pickHeaders(upstream.headers, FORWARDED_RESPONSE_HEADERS);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
