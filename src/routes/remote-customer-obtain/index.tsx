import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { defaultPageMeta } from "../../lib/shell-data";

export default defineRoute<{ publicPath: string }>({
  path: "/remote-customer-obtain",

  cache: (ctx) => sharedUnlessBypass(ctx, ["remote-customer-obtain", ctx.publicPath]),

  loader: async (ctx) => ({ data: { publicPath: ctx.publicPath } }),

  title: () => "Uzaktan Müşteri Edinimi",

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
