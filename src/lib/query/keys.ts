import type { BlogOrderBy } from "~/lib/contracts/blogs";

export const queryKeys = {
  blogs: {
    all: ["blogs"] as const,
    list: (page: number, orderBy: BlogOrderBy) =>
      [...queryKeys.blogs.all, "list", { page, orderBy }] as const,
  },
  account: {
    all: ["account"] as const,
    summary: () => [...queryKeys.account.all, "summary"] as const,
  },
} as const;
