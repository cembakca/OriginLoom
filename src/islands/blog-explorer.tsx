import { useState } from "react";

import { BlogList, PageSummary } from "~/features/blogs-paginated/components";
import {
  BLOG_ORDER_OPTIONS,
  type BlogOrderBy,
  DEFAULT_BLOG_ORDER,
  type PaginatedBlogs,
} from "~/lib/contracts/blogs";
import { useBlogs } from "~/lib/query/hooks/use-blogs";

type Props = {
  page: number;
  initialData: PaginatedBlogs;
};

/** Client sıralama — orderBy cache key dışı; TanStack Query + /api/blogs BFF. */
import { AppQueryProvider } from "~/lib/query/provider";

function BlogExplorerInner({ page, initialData }: Props) {
  const [orderBy, setOrderBy] = useState<BlogOrderBy>(DEFAULT_BLOG_ORDER);

  const query = useBlogs({
    page,
    orderBy,
    ...(orderBy === DEFAULT_BLOG_ORDER ? { initialData } : {}),
  });

  const { data, isFetching, isError, error } = query;

  const result = data ?? initialData;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          Sırala
          <select
            value={orderBy}
            onChange={(e) => setOrderBy(e.target.value as BlogOrderBy)}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            aria-label="Blog sıralama"
          >
            {BLOG_ORDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {isFetching && (
          <span className="text-xs text-slate-500" aria-live="polite">
            Güncelleniyor…
          </span>
        )}
      </div>

      {isError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Liste yüklenemedi: {error instanceof Error ? error.message : "Bilinmeyen hata"}
        </p>
      )}

      <PageSummary page={result.page} totalPages={result.totalPages} total={result.total} />

      <BlogList posts={result.posts} />
    </div>
  );
}

export default function BlogExplorer(props: Props) {
  return (
    <AppQueryProvider>
      <BlogExplorerInner {...props} />
    </AppQueryProvider>
  );
}
