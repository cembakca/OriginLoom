import { defineMiddleware } from "@originloom/core/middleware";

/**
 * Planned maintenance, decided per request rather than at import time: an
 * operator flips the env on the running deployment and the very next request
 * sees it, without waiting for a rollout.
 *
 * It sits in `before-auth` because a closed site should not be refreshing
 * tokens, writing session cookies or calling the gateway on the way to a 503.
 */
export const maintenanceMiddleware = defineMiddleware({
  name: "maintenance",
  phase: "before-auth",
  handler: () => {
    const retryAfter = maintenanceState();
    if (retryAfter === null) return;
    return { response: maintenanceResponse(retryAfter) };
  },
});

/** Seconds to ask clients to wait, or `null` when the site is open. */
function maintenanceState(): number | null {
  const flag = process.env.MAINTENANCE_MODE?.trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return null;
  const retryAfter = Number(process.env.MAINTENANCE_RETRY_AFTER_SECONDS ?? 120);
  return Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : 120;
}

function maintenanceResponse(retryAfterSeconds: number): Response {
  return new Response(maintenancePage(), {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": String(retryAfterSeconds),
      // A 503 is heuristically cacheable. Nothing in front of the app may keep
      // serving it after maintenance ends.
      "cache-control": "private, no-store",
    },
  });
}

function maintenancePage(): string {
  return (
    "<!DOCTYPE html>" +
    '<html lang="tr">' +
    '<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    "<title>Bakım çalışması</title></head>" +
    '<body><main style="max-width:480px;margin:4rem auto;font-family:system-ui">' +
    "<h1>Kısa bir bakım çalışması yapıyoruz</h1>" +
    "<p>Site birazdan tekrar açılacak. Lütfen daha sonra yeniden deneyin.</p>" +
    "</main></body></html>"
  );
}
