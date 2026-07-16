import { getPaginatedBlogs } from "@server/services/blogs";

import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { neverCache } from "~/lib/cache-policy";
import { resolvePageParam } from "~/lib/content-values";
import { DEFAULT_BLOG_ORDER, type PaginatedBlogs } from "~/lib/contracts/blogs";
import { Island } from "~/lib/island";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "~/lib/types";
import { BlogExplorerShell } from "~/routes/blogs-paginated/blog-explorer-shell";
import { PaginationShell } from "~/routes/blogs-paginated/pagination-shell";

export default defineRoute<PaginatedBlogs>({
  path: "/blogs/paginated",

  cache: (ctx) =>
    resolvePageParam(ctx.url.searchParams.get("page")).kind === "valid"
      ? pageCachePolicy(PageCacheId.blogsPaginated, ctx)
      : neverCache(),

  loader: async (ctx) => {
    const pageParam = resolvePageParam(ctx.url.searchParams.get("page"));
    if (pageParam.kind === "invalid") return notFound();
    if (pageParam.kind === "redirect") {
      const canonical = new URL(ctx.url);
      if (pageParam.page === 1) canonical.searchParams.delete("page");
      else canonical.searchParams.set("page", String(pageParam.page));
      return redirect(`${canonical.pathname}${canonical.search}`, 308);
    }

    const page = pageParam.page;
    const data = await getPaginatedBlogs(page, { orderBy: DEFAULT_BLOG_ORDER });
    if (data.totalPages > 0 && page > data.totalPages) return notFound();
    if (data.page !== page) throw new Error("Blogs gateway returned a mismatched page");
    return { data };
  },

  generateMetadata: (data, ctx) => {
    const title = `Blog — Sayfa ${data.page}`;
    const canonicalPath = data.page === 1 ? ctx.publicPath : `${ctx.publicPath}?page=${data.page}`;
    const url = publicAbsoluteUrl(ctx, canonicalPath);
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

      <Island name="blog-explorer" mode="defer" props={{ page: data.page, initialData: data }}>
        <BlogExplorerShell data={data} />
      </Island>

      <PaginationShell page={data.page} totalPages={data.totalPages} />
    </div>
  ),
});
