import { gatewayFetch } from "./gateway";

export function storeBotVisit(payload: {
  pathname: string;
  userAgent: string;
  trackingId?: string;
}): void {
  void gatewayFetch("/analytics/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
