import { config } from "@server/config";

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function cleanHeaders(input: Headers): Headers {
  const headers = new Headers(input);
  for (const name of HOP_BY_HOP) headers.delete(name);
  return headers;
}

/** Forward request to the configured gateway/CDN rewrite target. */
export async function proxyRequest(
  request: Request,
  targetUrl: string,
  clientIp?: string,
): Promise<Response> {
  const url = new URL(targetUrl);
  const headers = cleanHeaders(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-forwarded-for");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
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
  const responseHeaders = cleanHeaders(upstream.headers);
  responseHeaders.delete("server");
  responseHeaders.delete("x-powered-by");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
