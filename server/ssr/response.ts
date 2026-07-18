import * as cache from "@server/cache";
import { logger } from "@server/logger";

import type { LoaderResult, Route } from "~/lib/types";

type CachePolicy = ReturnType<NonNullable<Route["cache"]>>;

export function htmlResponse(
  body: string | ReadableStream,
  status: number,
  policy: CachePolicy,
  state: string,
  extra?: Record<string, string>,
  requestId?: string,
): Response {
  const isStream = body instanceof ReadableStream;
  const headers: Record<string, string> = {
    ...extra,
    "content-type": "text/html; charset=utf-8",
    "cache-control": isStream
      ? "no-transform, no-cache, no-store, must-revalidate"
      : cache.cacheControl(policy),
    "x-cache": state,
  };
  if (requestId) headers["x-request-id"] = requestId;
  if (isStream) headers["transfer-encoding"] = "chunked";

  return new Response(body, { status, headers });
}

export function headResponse(
  status: number,
  policy: CachePolicy,
  state: string,
  extra?: Record<string, string>,
  requestId?: string,
): Response {
  const headers = new Headers({
    ...extra,
    "content-type": "text/html; charset=utf-8",
    "cache-control": cache.cacheControl(policy),
    "x-cache": state,
  });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status, headers });
}

export function loaderRedirectResponse(
  result: Extract<LoaderResult<unknown>, { kind: "redirect" }>,
  routeUrl: URL,
  requestId?: string,
): Response {
  const headers = new Headers(result.headers);
  headers.set("location", new URL(result.location, routeUrl).toString());
  headers.set("cache-control", "private, no-store");
  headers.set("x-cache", "BYPASS");
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(null, { status: result.status ?? 307, headers });
}

export function normalizeErrorStatus(status = 500): number {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError(`Route error status must be between 400 and 599: ${status}`);
  }
  return status;
}

export function logRequest(
  requestId: string | undefined,
  fields: { path: string; status: number; cache: string; durationMs: number },
): void {
  logger.info("request", {
    ...fields,
    ...(requestId !== undefined ? { requestId } : {}),
  });
}
