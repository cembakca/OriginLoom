import { mountPreviewApi } from "@originloom/core/api/preview";
import { mountServerIslandApi } from "@originloom/core/api/server-island";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { serverIslands } from "@server/islands";
import type { Hono } from "hono";

import { mountInternalApi } from "./internal";
import { mountLoanCalculatorApi } from "./loan-calculator";
import { mountMarketStreamApi } from "./market-stream";
import { mountReferralApi } from "./referrals";

export function mountApi(app: Hono<{ Variables: AppVariables }>): void {
  mountInternalApi(app);
  mountMarketStreamApi(app);
  mountLoanCalculatorApi(app);
  mountReferralApi(app);
  // Fills the holes left in cached HTML. Answers are always private/no-store —
  // this is the half of the page that was kept out of the shared cache.
  mountServerIslandApi(app, serverIslands);
  // Draft preview: exchanges the editor's secret for a short-lived signed
  // cookie. Off entirely when PREVIEW_SECRET is unset.
  mountPreviewApi(app);
}
