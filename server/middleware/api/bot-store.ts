import { gatewayFetch } from "@server/adapters/gateway";
import { logger } from "@server/logger";

export function storeBotVisit(payload: {
  pathname: string;
  userAgent: string;
  trackingId?: string;
}): void {
  void gatewayFetch("/analytics/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((response) => {
      if (!response.ok) {
        logger.warn("bot analytics write rejected", {
          pathname: payload.pathname,
          status: response.status,
        });
      }
    })
    .catch((error: unknown) => {
      logger.warn("bot analytics write failed", {
        pathname: payload.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
