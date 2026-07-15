import type { AppVariables } from "@server/middleware/request-id";
import type { Hono } from "hono";

import { mountInternalApi } from "./internal";

export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  mountInternalApi(app);
}
