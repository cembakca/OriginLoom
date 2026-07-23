import { defineRoute } from "@originloom/react/lib/types";

import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<{ publicPath: string }>({
  path: "/remote-customer-obtain",

  cache: (ctx) => pageCachePolicy(PageCacheId.remoteCustomerObtain, ctx),

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
