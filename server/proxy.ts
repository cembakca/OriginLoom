/** Forward request to an external URL (gateway, CDN). Used by rewrite rules with http destination. */
export async function proxyRequest(request: Request, targetUrl: string): Promise<Response> {
  const url = new URL(targetUrl);
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // @ts-expect-error — required for streaming body in Node 22
    init.duplex = "half";
  }

  const upstream = await fetch(url, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("x-proxy-upstream", url.origin);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
