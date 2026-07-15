import type { AppVariables } from "@server/middleware/request-id";
import type { Hono } from "hono";

import { mountBlogsApi } from "./blogs";
import { mountInternalApi } from "./internal";
import { mountCachePurgeRoutes } from "./internal/cache-purge";

export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  mountBlogsApi(app);
  mountInternalApi(app);
  mountCachePurgeRoutes(app);
}
