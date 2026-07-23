import { ClientApiError, clientApiFetch } from "@originloom/react/lib/client/api-fetch";
import { seedUserInfo } from "@originloom/react/lib/stores/user-info-store";
import { useQuery } from "@tanstack/react-query";

import type { AccountSummary } from "~/lib/contracts/account";
import { queryKeys } from "~/lib/query/keys";

export async function fetchAccountSummaryApi(): Promise<AccountSummary> {
  const summary = await clientApiFetch<AccountSummary>("/api/internal/account/summary");
  seedUserInfo({
    isSignedIn: true,
    displayName: summary.profile.displayName,
    initials: summary.profile.initials,
  });
  return summary;
}

/** Kişisel hesap özeti — defer island, pipeline auth ile BFF. */
export function useAccountSummary(enabled = true) {
  return useQuery({
    queryKey: queryKeys.account.summary(),
    queryFn: fetchAccountSummaryApi,
    enabled,
    retry: (count, error) => {
      if (error instanceof ClientApiError && error.status === 401) return false;
      return count < 1;
    },
  });
}
