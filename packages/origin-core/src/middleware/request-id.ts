import type { MiddlewareHandler } from "hono";

import type { AppVariables } from "./context";

export type { AppVariables } from "./context";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function normalizeRequestId(value: string | undefined): string {
  return value && SAFE_REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

export const requestId: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const id = normalizeRequestId(c.req.header("x-request-id"));
  c.set("requestId", id);
  await next();
  // Downstream handlers may replace c.res entirely; set it on the final response.
  try {
    c.res.headers.set("x-request-id", id);
  } catch {
    // Fetch-created redirect/error responses can have an immutable header guard.
    const headers = new Headers(c.res.headers);
    headers.set("x-request-id", id);
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  }
};
