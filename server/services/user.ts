import { gatewayFetchForRequest } from "@server/adapters/gateway";
import { runtimeMocksEnabled } from "@server/config";

import type { UserProfile } from "~/lib/contracts/account";

export type UserProfileResult =
  { kind: "ok"; profile: UserProfile } | { kind: "unauthorized" } | { kind: "unavailable" };

export async function fetchUserProfileResult(request: Request): Promise<UserProfileResult> {
  const auth = request.headers.get("authorization");
  if (!auth) return { kind: "unauthorized" };

  try {
    const res = await gatewayFetchForRequest(request, "/user/profile");
    if (res.status === 401 || res.status === 403) {
      return runtimeMocksEnabled()
        ? { kind: "ok", profile: mockProfile(auth) }
        : { kind: "unauthorized" };
    }
    if (!res.ok) {
      return runtimeMocksEnabled()
        ? { kind: "ok", profile: mockProfile(auth) }
        : { kind: "unavailable" };
    }

    const data: unknown = await res.json();
    if (!isUserProfilePayload(data)) {
      return runtimeMocksEnabled()
        ? { kind: "ok", profile: mockProfile(auth) }
        : { kind: "unavailable" };
    }
    return {
      kind: "ok",
      profile: {
        displayName: data.displayName,
        initials: data.initials ?? data.displayName.slice(0, 2).toUpperCase(),
      },
    };
  } catch {
    return runtimeMocksEnabled()
      ? { kind: "ok", profile: mockProfile(auth) }
      : { kind: "unavailable" };
  }
}

/** SSR callers that can gracefully render without a profile. */
export async function fetchUserProfile(request: Request): Promise<UserProfile | null> {
  const result = await fetchUserProfileResult(request);
  return result.kind === "ok" ? result.profile : null;
}

function isUserProfilePayload(data: unknown): data is { displayName: string; initials?: string } {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return (
    typeof value.displayName === "string" &&
    (value.initials === undefined || typeof value.initials === "string")
  );
}

function mockProfile(auth: string): UserProfile {
  const token = auth.replace(/^Bearer\s+/i, "");
  const suffix = token.slice(-4) || "anon";
  return { displayName: `User ${suffix}`, initials: suffix.slice(0, 2).toUpperCase() };
}
