import { gatewayFetch } from "../lib/gateway-fetch";

export type UserProfile = {
  initials: string;
  displayName: string;
};

/** Fetch user profile from gateway using middleware-injected Authorization header. */
export async function fetchUserProfile(request: Request): Promise<UserProfile | null> {
  const auth = request.headers.get("Authorization");
  if (!auth) return null;

  try {
    const res = await gatewayFetch(request, "/user/profile");
    if (!res.ok) return mockProfile(auth);
    const data = (await res.json()) as { displayName?: string; initials?: string };
    if (!data.displayName) return mockProfile(auth);
    return {
      displayName: data.displayName,
      initials: data.initials ?? data.displayName.slice(0, 2).toUpperCase(),
    };
  } catch {
    return mockProfile(auth);
  }
}

function mockProfile(auth: string): UserProfile {
  const token = auth.replace(/^Bearer\s+/i, "");
  const suffix = token.slice(-4) || "anon";
  return { displayName: `User ${suffix}`, initials: suffix.slice(0, 2).toUpperCase() };
}

/** Example GW page fetch for retirement-banking demo — use fetchRetirementBankingPage from services/pages. */
export async function fetchRetirementBankingContent(
  request: Request,
): Promise<{ headline: string; authenticated: boolean }> {
  const { fetchRetirementBankingPage } = await import("./pages");
  const page = await fetchRetirementBankingPage(request);
  return { headline: page.headline, authenticated: page.authenticated };
}
