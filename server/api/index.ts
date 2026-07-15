import type { Hono } from "hono";
import { handleMe } from "./me";
import type { AppVariables } from "../middleware/request-id";

export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/me", (c) => handleMe(c.req.raw));
}
