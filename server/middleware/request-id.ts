import type { MiddlewareHandler } from "hono";

export type AppVariables = {
  requestId: string;
};

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function normalizeRequestId(value: string | undefined): string {
  return value && SAFE_REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

export const requestId: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const id = normalizeRequestId(c.req.header("x-request-id"));
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};
