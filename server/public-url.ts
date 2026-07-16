export function publicUrlRedirectResponse(location: string, requestId?: string): Response {
  const headers = new Headers({
    location,
    "cache-control": "private, no-store",
    "x-cache": "REDIRECT",
  });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status: 308, headers });
}

export function publicUrlErrorResponse(requestId?: string): Response {
  const headers = new Headers({
    "content-type": "text/plain; charset=UTF-8",
    "cache-control": "private, no-store",
    "x-cache": "BYPASS",
  });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response("Bad Request", { status: 400, headers });
}
