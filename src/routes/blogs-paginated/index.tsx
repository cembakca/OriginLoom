import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { Island } from "~/lib/island";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";
import {
  DEFAULT_BLOG_ORDER,
  getPaginatedBlogs,
  type PaginatedBlogs,
  parsePageParam,
} from "~/services/blogs";

import { BlogExplorerShell } from "./blog-explorer-shell";
import { PaginationShell } from "./pagination-shell";

export default defineRoute<PaginatedBlogs>({
  path: "/blogs/paginated",

  cache: (ctx) => pageCachePolicy(PageCacheId.blogsPaginated, ctx),

  loader: async (ctx) => {
    const page = parsePageParam(ctx.url.searchParams.get("page"));
    const data = await getPaginatedBlogs(page, { orderBy: DEFAULT_BLOG_ORDER });
    return { data };
  },

  generateMetadata: (data, ctx) => {
    const title = `Blog — Sayfa ${data.page}`;
    const url = publicAbsoluteUrl(ctx);
    return {
      title,
      description: `Finans ve bankacılık blog yazıları — sayfa ${data.page}.`,
      canonical: url,
      openGraph: { title, url },
    };
  },

  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "blog-list", {
      category: "content",
      mid: "blog",
      sub: `page-${data.page}`,
    }),

  Component: ({ data }) => (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">Blog Yazıları</h1>
        <p className="text-slate-600">
          SSR cache (sayfa) + client sıralama (TanStack Query) —{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">
            /blogs/paginated?page={data.page}
          </code>
        </p>
      </div>

      <Island
        name="blog-explorer"
        mode="defer"
        eager
        props={{ page: data.page, initialData: data }}
      >
        <BlogExplorerShell data={data} />
      </Island>

      <Island
        name="blog-pagination"
        mode="hydrate"
        props={{ page: data.page, totalPages: data.totalPages }}
      >
        <PaginationShell page={data.page} totalPages={data.totalPages} />
      </Island>
    </div>
  ),
});
