import type { Hono } from "hono";
import { mountInternalApi } from "./internal";
import type { AppVariables } from "../middleware/request-id";

export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  mountInternalApi(app);
}
