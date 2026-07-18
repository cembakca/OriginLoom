import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import type { Hono } from "hono";

import { mountAccountApi } from "./account";
import { handleRefresh, mountAuthSessionApi } from "./auth-session";
import { mountClientErrorApi } from "./client-errors";
import { mountReferralStatsApi } from "./referral-stats";

export { handleRefresh };

export function mountInternalApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/internal/refresh", (c) => handleRefresh(contextRequest(c)));
  mountAuthSessionApi(app);
  mountAccountApi(app);
  mountClientErrorApi(app);
  mountReferralStatsApi(app);
}
