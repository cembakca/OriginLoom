import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { locale } from "../../lib/request";
import { Island } from "../../lib/island";
import { SiteHeader } from "../../components/layout/site-header";
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
    ]),

  loader: async (ctx) => {
    const page = parsePageParam(ctx.url.searchParams.get("page"));
    const data = await getPaginatedBlogs(page);
    return { data };
  },

  title: (d) => `Blog — Sayfa ${d.page}`,

  Component: ({ data }) => (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <SiteHeader />

      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: "0 0 0.5rem" }}>Blog Yazıları</h1>
        <p style={{ margin: 0, color: "#64748b" }}>
          SSR + cache + React component örneği — <code>/blogs/paginated?page={data.page}</code>
        </p>
      </header>

      <PageSummary page={data.page} totalPages={data.totalPages} total={data.total} />

      <BlogList posts={data.posts} />

      <Island
        name="blog-pagination"
        mode="hydrate"
        props={{ page: data.page, totalPages: data.totalPages }}
      >
        <PaginationShell page={data.page} totalPages={data.totalPages} />
      </Island>
    </main>
  ),
});
