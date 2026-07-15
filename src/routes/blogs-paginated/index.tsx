import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { locale } from "../../lib/request";
import { Island } from "../../lib/island";
import { defaultPageMeta, layoutCacheFragment } from "../../lib/shell-data";
import { generateMetaDataForPageWithDummySeoInfo, publicAbsoluteUrl } from "../../lib/metadata/generate";
import { getPaginatedBlogs, parsePageParam, type PaginatedBlogs } from "../../services/blogs";
import { BlogList, PageSummary } from "./components";
import { PaginationShell } from "./pagination-shell";

export default defineRoute<PaginatedBlogs>({
  path: "/blogs/paginated",

  cache: (ctx) =>
    sharedUnlessBypass(ctx, [
      "blogs-paginated",
      ctx.publicPath,
      ctx.url.searchParams.get("page") ?? "1",
      locale(ctx.request),
      layoutCacheFragment(ctx),
    ]),

  loader: async (ctx) => {
    const page = parsePageParam(ctx.url.searchParams.get("page"));
    const data = await getPaginatedBlogs(page);
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
          SSR + cache + island — <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">/blogs/paginated?page={data.page}</code>
        </p>
      </div>

      <PageSummary page={data.page} totalPages={data.totalPages} total={data.total} />

      <BlogList posts={data.posts} />

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
