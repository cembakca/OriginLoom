import type { UserProfile } from "./user";
import { fetchUserProfile } from "./user";

export type AccountActivity = {
  id: string;
  label: string;
  at: string;
};

export type AccountSummary = {
  profile: UserProfile;
  recentActivity: AccountActivity[];
  stats: {
    comparisonsThisMonth: number;
    savedOffers: number;
  };
};

/** BFF account summary — gateway profile + demo aktivite. */
export async function fetchAccountSummary(request: Request): Promise<AccountSummary | null> {
  const profile = await fetchUserProfile(request);
  if (!profile) return null;

  return {
    profile,
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
    stats: {
      comparisonsThisMonth: 4,
      savedOffers: 2,
    },
  };
}
