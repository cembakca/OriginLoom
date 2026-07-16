import { useQuery } from "@tanstack/react-query";

import { clientApiFetch } from "~/lib/client/api-fetch";
import type { BlogOrderBy, PaginatedBlogs } from "~/lib/contracts/blogs";
import { queryKeys } from "~/lib/query/keys";

type BlogsQueryParams = {
  page: number;
  orderBy: BlogOrderBy;
  initialData?: PaginatedBlogs;
};

export function fetchBlogsApi(params: {
  page: number;
  orderBy: BlogOrderBy;
}): Promise<PaginatedBlogs> {
  const qs = new URLSearchParams({
    page: String(params.page),
    orderBy: params.orderBy,
  });
  return clientApiFetch<PaginatedBlogs>(`/api/blogs?${qs}`);
}

/** Client-side blog listesi — orderBy cache key dışı, TanStack ile yönetilir. */
export function useBlogs({ page, orderBy, initialData }: BlogsQueryParams) {
  return useQuery({
    queryKey: queryKeys.blogs.list(page, orderBy),
    queryFn: () => fetchBlogsApi({ page, orderBy }),
    ...(initialData ? { initialData } : {}),
  });
}
