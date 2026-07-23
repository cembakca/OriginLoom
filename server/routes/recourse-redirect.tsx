import { isKnownRecoursePage } from "@server/services/route-domains";

import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "@originloom/react/lib/types";

export default defineRoute<{ page: string; publicPath: string }>({
  path: "/recourse/:page/redirect",
  minimalChrome: true,

  validateParams: (ctx) => isKnownRecoursePage(ctx.params.page, ctx.request.signal),

  cache: (ctx) => pageCachePolicy(PageCacheId.recourseRedirect, ctx),

  loader: async (ctx) => ({
    data: { page: ctx.params.page ?? "", publicPath: ctx.publicPath },
  }),

  generateMetadata: (data, ctx) => ({
    ...generateMetaDataForPageWithDummySeoInfo("/recourse-redirect", ctx),
    title: `Başvuru yönlendirme — ${data.page}`,
    robots: { index: false, follow: true },
  }),

  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "recourse-redirect", { category: "redirect", sub: data.page }),

  Component: ({ data }) => (
    <>
      <h1>Başvuru yönlendirme</h1>
      <p>
        Param: <code>{data.page}</code>
      </p>
      <p>
        <code>/basvuru/{data.page}/yonlendirme</code> → <code>/recourse/{data.page}/redirect</code>
      </p>
    </>
  ),
});
