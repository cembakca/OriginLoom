import { gatewayFetchForRequest } from "@server/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@server/gateway-payload";

import type { AccountActivity, AccountSummary, UserProfile } from "~/lib/contracts/account";
import { isBoundedArray, isBoundedString, isFiniteNumber, isRecord } from "~/lib/runtime-schema";

const INVALID_ACCOUNT = "Account gateway returned an invalid payload";

export type AccountSummaryResult =
  { kind: "ok"; summary: AccountSummary } | { kind: "unauthorized" } | { kind: "unavailable" };

export async function fetchAccountSummary(request: Request): Promise<AccountSummaryResult> {
  if (!request.headers.get("authorization")) return { kind: "unauthorized" };

  try {
    const response = await gatewayFetchForRequest(request, "/account/summary");
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "unavailable" };

    const payload = await readGatewayJson(response, "account", INVALID_ACCOUNT);
    const data = requireGatewayPayload("account", payload, isAccountSummary, INVALID_ACCOUNT);
    return { kind: "ok", summary: data };
  } catch {
    return { kind: "unavailable" };
  }
}

function isAccountSummary(data: unknown): data is AccountSummary {
  return (
    isRecord(data) &&
    isUserProfile(data.profile) &&
    isBoundedArray(data.recentActivity, 50, isAccountActivity) &&
    isRecord(data.stats) &&
    isFiniteNumber(data.stats.comparisonsThisMonth, { integer: true, min: 0, max: 1_000_000 }) &&
    isFiniteNumber(data.stats.savedOffers, { integer: true, min: 0, max: 1_000_000 })
  );
}

function isUserProfile(value: unknown): value is UserProfile {
  return (
    isRecord(value) &&
    isBoundedString(value.displayName, 120) &&
    value.displayName.trim().length > 0 &&
    isBoundedString(value.initials, 8)
  );
}

function isAccountActivity(value: unknown): value is AccountActivity {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 128) &&
    isBoundedString(value.label, 500) &&
    isBoundedString(value.at, 64) &&
    Number.isFinite(Date.parse(value.at))
  );
}
