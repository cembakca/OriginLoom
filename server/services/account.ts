import type { AccountSummary } from "~/lib/contracts/account";

import { fetchUserProfileResult } from "./user";

export type AccountSummaryResult =
  { kind: "ok"; summary: AccountSummary } | { kind: "unauthorized" } | { kind: "unavailable" };

export async function fetchAccountSummary(request: Request): Promise<AccountSummaryResult> {
  const user = await fetchUserProfileResult(request);
  if (user.kind !== "ok") return user;

  return {
    kind: "ok",
    summary: {
      profile: user.profile,
      recentActivity: [
        {
          id: "act-1",
          label: "İhtiyaç kredisi karşılaştırma görüntülendi",
          at: new Date(Date.now() - 3_600_000).toISOString(),
        },
        {
          id: "act-2",
          label: "Blog yazısı okundu",
          at: new Date(Date.now() - 86_400_000).toISOString(),
        },
        {
          id: "act-3",
          label: "Emekli bankacılığı sayfası ziyaret edildi",
          at: new Date(Date.now() - 172_800_000).toISOString(),
        },
      ],
      stats: { comparisonsThisMonth: 4, savedOffers: 2 },
    },
  };
}
