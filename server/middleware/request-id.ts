import type { MiddlewareHandler } from "hono";

export type AppVariables = {
  requestId: string;
};

export const requestId: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const id = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};
