import type { AppVariables } from "@server/middleware/request-id";
import type { Hono } from "hono";

import { mountAccountApi } from "./account";
import { handleRefresh, mountAuthSessionApi } from "./auth-session";

export { handleRefresh };

export function mountInternalApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/internal/refresh", (c) => handleRefresh(c.req.raw));
  mountAuthSessionApi(app);
  mountAccountApi(app);
}
