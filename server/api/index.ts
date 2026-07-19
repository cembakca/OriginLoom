import type { AppVariables } from "@server/middleware/request-id";
import type { Hono } from "hono";

import { mountInternalApi } from "./internal";
import { mountCachePurgeRoutes } from "./internal/cache-purge";
import { mountMarketStreamApi } from "./market-stream";
import { mountReferralApi } from "./referrals";

export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  mountInternalApi(app);
  mountCachePurgeRoutes(app);
  mountMarketStreamApi(app);
  mountReferralApi(app);
}
