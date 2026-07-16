import type { PaginatedBlogs } from "~/lib/contracts/blogs";
import { BlogList, PageSummary } from "~/routes/blogs-paginated/components";

/** SSR fallback — defer island mount öncesi varsayılan sıralama. */
export function BlogExplorerShell({ data }: { data: PaginatedBlogs }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          Sırala
          <select
            disabled
            defaultValue="date-desc"
            className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
            aria-hidden
          >
            <option>En yeni</option>
          </select>
        </label>
      </div>
      <PageSummary page={data.page} totalPages={data.totalPages} total={data.total} />
      <BlogList posts={data.posts} />
    </div>
  );
}
