import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import { classifyRequest } from "./request-deadline.js";
import type { AppVariables } from "./request-id.js";

/**
 * Caps how much body the process will read from an untrusted client.
 *
 * It has to run before anything that clones the request: a clone locks the
 * original's body, and a request that arrives without content-length has to be
 * read to be measured — on a locked stream that read throws, and every bodiless
 * POST turns into a 500. Hono hands the buffered body back on `c.req.raw`, so
 * middleware downstream still sees a readable request.
 *
 * Running that early also means `requestClass` is not in context yet, so the
 * error path classifies the request itself and falls back to the context value
 * for callers that mount this middleware on their own.
 */
export function publicBodyLimit(maxSize: number): MiddlewareHandler<{
  Variables: AppVariables;
}> {
  return bodyLimit({
    maxSize,
    onError: (c) =>
      (c.get("requestClass") ?? classifyRequest(c.req.raw)) === "api"
        ? c.json({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" }, 413)
        : c.text("Payload too large", 413),
  });
}
