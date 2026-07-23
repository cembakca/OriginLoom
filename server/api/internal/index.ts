import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import type { Hono } from "hono";

import { mountAccountApi } from "./account";
import { handleRefresh, mountAuthSessionApi } from "./auth-session";
import { mountClientErrorApi } from "./client-errors";

export { handleRefresh };

export function mountInternalApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/internal/refresh", (c) =>
    handleRefresh(contextRequest(c), c.get("clientIp") ?? "unresolved"),
  );
  mountAuthSessionApi(app);
  mountAccountApi(app);
  mountClientErrorApi(app);
}
