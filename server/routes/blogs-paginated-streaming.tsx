import { getPaginatedBlogs } from "@server/services/blogs";
import { Suspense, use } from "react";

import { BlogExplorerShell } from "~/features/blogs-paginated/blog-explorer-shell";
import { PaginationShell } from "~/features/blogs-paginated/pagination-shell";
import { neverCache } from "~/lib/cache-policy";
import { resolvePageParam } from "~/lib/content-values";
import { type Blog, DEFAULT_BLOG_ORDER, type PaginatedBlogs } from "~/lib/contracts/blogs";
import { Island } from "~/lib/island";
import { generateMetaDataForPageWithSeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "~/lib/types";

type StreamingBlogsData = PaginatedBlogs & {
  deferredPostsPromise: Promise<Blog[]>;
};

function BlogListSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm"
        >
          <div className="h-4 bg-slate-200 rounded w-1/4"></div>
          <div className="space-y-2">
            <div className="h-6 bg-slate-200 rounded w-3/4"></div>
            <div className="h-4 bg-slate-200 rounded w-5/6"></div>
            <div className="h-4 bg-slate-200 rounded w-2/3"></div>
          </div>
          <div className="flex justify-between items-center pt-2">
            <div className="h-4 bg-slate-200 rounded w-1/3"></div>
            <div className="h-4 bg-slate-200 rounded w-1/4"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StreamingBlogList({
  postsPromise,
  initialData,
}: {
  postsPromise: Promise<Blog[]>;
  initialData: PaginatedBlogs;
}) {
  const posts = use(postsPromise);
  const resolvedData = { ...initialData, posts };
  return (
    <Island
      name="blog-explorer"
      mode="defer"
      props={{ page: resolvedData.page, initialData: resolvedData }}
    >
      <BlogExplorerShell data={resolvedData} />
    </Island>
  );
}

export default defineRoute<StreamingBlogsData>({
  path: "/blogs/paginated/streaming",
  streaming: true,

  cache: () => neverCache(),

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
    const data = await getPaginatedBlogs(page, {
      orderBy: DEFAULT_BLOG_ORDER,
      signal: ctx.request.signal,
    });
    if (data.totalPages > 0 && page > data.totalPages) return notFound();
    if (data.page !== page) throw new Error("Blogs gateway returned a mismatched page");

    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const deferredPosts = delay(1500).then(() => data.posts);

    return {
      data: {
        ...data,
        deferredPostsPromise: deferredPosts,
      },
    };
  },

  generateMetadata: (data, ctx) =>
    generateMetaDataForPageWithSeoInfo(
      {
        title: `Blog Akışlı SSR Demosu — Sayfa ${data.page}`,
        metaDescription: "React streaming SSR davranışını gösteren teknik demo sayfası.",
        friendlyUrl: "/blogs/paginated/streaming",
        noindex: true,
      },
      ctx,
    ),

  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "blog-list-streaming", {
      category: "content",
      mid: "blog-streaming",
      sub: `page-${data.page}`,
    }),

  Component: ({ data }) => (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">Blog Yazıları (Akışlı SSR)</h1>
        <p className="text-slate-600">
          SSR cache + client sıralama (TanStack Query) + React 19 Streaming —{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">
            /blogs/paginated/streaming?page={data.page}
          </code>
        </p>
      </div>

      <Suspense fallback={<BlogListSkeleton />}>
        <StreamingBlogList postsPromise={data.deferredPostsPromise} initialData={data} />
      </Suspense>

      <PaginationShell page={data.page} totalPages={data.totalPages} />
    </div>
  ),
});
