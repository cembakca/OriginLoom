import { gatewayFetchForRequest } from "@server/adapters/gateway";
import { runtimeMocksEnabled } from "@server/config";

import type { UserProfile } from "~/lib/contracts/account";

export async function fetchUserProfile(request: Request): Promise<UserProfile | null> {
  const auth = request.headers.get("authorization");
  if (!auth) return null;

  try {
    const res = await gatewayFetchForRequest(request, "/user/profile");
    if (!res.ok) return runtimeMocksEnabled() ? mockProfile(auth) : null;
    const data: unknown = await res.json();
    if (!isUserProfilePayload(data)) return runtimeMocksEnabled() ? mockProfile(auth) : null;
    return {
      displayName: data.displayName,
      initials: data.initials ?? data.displayName.slice(0, 2).toUpperCase(),
    };
  } catch {
    return runtimeMocksEnabled() ? mockProfile(auth) : null;
  }
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
