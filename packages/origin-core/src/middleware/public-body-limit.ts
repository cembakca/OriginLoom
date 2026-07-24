import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AppVariables } from "./request-id.js";

export function publicBodyLimit(maxSize: number): MiddlewareHandler<{
  Variables: AppVariables;
}> {
  return bodyLimit({
    maxSize,
    onError: (c) =>
      c.get("requestClass") === "api"
        ? c.json({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" }, 413)
        : c.text("Payload too large", 413),
  });
}
