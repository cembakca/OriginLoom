import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { defaultPageMeta } from "../../lib/shell-data";
import { generateMetaDataForPageWithDummySeoInfo } from "../../lib/metadata/generate";

export default defineRoute<{ page: string; publicPath: string }>({
  path: "/recourse/:page/redirect",
  minimalChrome: true,

  cache: (ctx) =>
    sharedUnlessBypass(ctx, ["recourse-redirect", ctx.params.page, ctx.publicPath]),

  loader: async (ctx) => ({
    data: { page: ctx.params.page, publicPath: ctx.publicPath },
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
