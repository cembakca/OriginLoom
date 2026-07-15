import { useQuery } from "@tanstack/react-query";

import { ClientApiError, clientApiFetch } from "~/lib/client/api-fetch";
import { queryKeys } from "~/lib/query/keys";
import type { AccountSummary } from "~/services/account";

export function fetchAccountSummaryApi(): Promise<AccountSummary> {
  return clientApiFetch<AccountSummary>("/api/internal/account/summary");
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
