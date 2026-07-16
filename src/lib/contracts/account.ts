export type UserProfile = {
  initials: string;
  displayName: string;
};

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
