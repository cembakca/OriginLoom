import { sharedUnlessBypass } from "~/lib/cache-policy";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta, layoutCacheFragment } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";

export default defineRoute<{ publicPath: string }>({
  path: "/remote-customer-obtain",

  cache: (ctx) =>
    sharedUnlessBypass(ctx, ["remote-customer-obtain", ctx.publicPath, layoutCacheFragment(ctx)]),

  loader: async (ctx) => ({ data: { publicPath: ctx.publicPath } }),

  generateMetadata: (_data, ctx) =>
    generateMetaDataForPageWithDummySeoInfo("/remote-customer-obtain", ctx),

  pageMeta: (_data, ctx) =>
    defaultPageMeta(ctx, "remote-customer-obtain", { category: "acquisition" }),

  Component: ({ data }) => (
    <>
      <h1>Uzaktan Müşteri Edinimi</h1>
      <p>
        Public URL: <code>{data.publicPath}</code> → internal <code>/remote-customer-obtain</code>
      </p>
    </>
  ),
});
