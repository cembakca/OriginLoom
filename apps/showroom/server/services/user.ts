import { gatewayFetchForRequest } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import { isBoundedString, isRecord } from "@originloom/shared/lib/runtime-schema";

import type { UserProfile } from "~/lib/contracts/account";

const INVALID_PROFILE = "Profile gateway returned an invalid payload";

export type UserProfileResult =
  { kind: "ok"; profile: UserProfile } | { kind: "unauthorized" } | { kind: "unavailable" };

export async function fetchUserProfileResult(request: Request): Promise<UserProfileResult> {
  if (!request.headers.get("authorization")) return { kind: "unauthorized" };

  try {
    const res = await gatewayFetchForRequest(request, "/user/profile");
    if (res.status === 401 || res.status === 403) {
      return { kind: "unauthorized" };
    }
    if (!res.ok) return { kind: "unavailable" };

    const payload = await readGatewayJson(res, "profile", INVALID_PROFILE);
    const data = requireGatewayPayload("profile", payload, isUserProfilePayload, INVALID_PROFILE);
    return {
      kind: "ok",
      profile: {
        displayName: data.displayName,
        initials: data.initials ?? data.displayName.slice(0, 2).toUpperCase(),
      },
    };
  } catch (error) {
    if (isRequestDeadlineError(request.signal.reason)) throw request.signal.reason;
    if (isRequestDeadlineError(error)) throw error;
    return { kind: "unavailable" };
  }
}

/** SSR callers that can gracefully render without a profile. */
export async function fetchUserProfile(request: Request): Promise<UserProfile | null> {
  const result = await fetchUserProfileResult(request);
  return result.kind === "ok" ? result.profile : null;
}

function isUserProfilePayload(data: unknown): data is { displayName: string; initials?: string } {
  return (
    isRecord(data) &&
    isBoundedString(data.displayName, 120) &&
    data.displayName.trim().length > 0 &&
    (data.initials === undefined || isBoundedString(data.initials, 8))
  );
}
