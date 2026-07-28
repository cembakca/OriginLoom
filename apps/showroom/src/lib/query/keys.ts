export const queryKeys = {
  account: {
    all: ["account"] as const,
    summary: () => [...queryKeys.account.all, "summary"] as const,
  },
} as const;
