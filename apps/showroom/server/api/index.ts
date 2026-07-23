import type { AppVariables } from "@originloom/core/middleware/request-id";
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
}
