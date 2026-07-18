import { referralStatsSecurityConfig } from "@server/config";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { getReferralStats } from "@server/services/financial-products";
import type { Hono } from "hono";

export async function handleReferralStats(request: Request): Promise<Response> {
  const denied = assertReferralStatsAuthorized(request);
  if (denied) return denied;
  const stats = await getReferralStats(request.signal);
  return json(stats);
}

export function mountReferralStatsApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/internal/referrals/stats", (c) => {
    c.set("requestRoute", "<api referral stats>");
    return handleReferralStats(contextRequest(c));
  });
}

function assertReferralStatsAuthorized(request: Request): Response | null {
  const { secret, isProduction } = referralStatsSecurityConfig();
  if (!secret) {
    return isProduction ? json({ error: "Referral stats erişimi yapılandırılmadı" }, 503) : null;
  }
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? request.headers.get("x-referral-stats-token");
  return token === secret ? null : json({ error: "Yetkisiz" }, 401);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
