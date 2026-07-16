import { gatewayFetchForRequest } from "@server/adapters/gateway";

import type { AccountSummary } from "~/lib/contracts/account";

export type AccountSummaryResult =
  { kind: "ok"; summary: AccountSummary } | { kind: "unauthorized" } | { kind: "unavailable" };

export async function fetchAccountSummary(request: Request): Promise<AccountSummaryResult> {
  if (!request.headers.get("authorization")) return { kind: "unauthorized" };

  try {
    const response = await gatewayFetchForRequest(request, "/account/summary");
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "unavailable" };

    const data: unknown = await response.json();
    if (!isAccountSummary(data)) return { kind: "unavailable" };
    return { kind: "ok", summary: data };
  } catch {
    return { kind: "unavailable" };
  }
}

function isAccountSummary(data: unknown): data is AccountSummary {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  if (!value.profile || typeof value.profile !== "object") return false;
  const profile = value.profile as Record<string, unknown>;
  const stats = value.stats as Record<string, unknown> | undefined;
  return (
    typeof profile.displayName === "string" &&
    typeof profile.initials === "string" &&
    Array.isArray(value.recentActivity) &&
    stats !== undefined &&
    typeof stats.comparisonsThisMonth === "number" &&
    typeof stats.savedOffers === "number"
  );
}
