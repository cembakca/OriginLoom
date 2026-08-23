import { signServerIslandPayload } from "@originloom/core/server-island";
import { defineRoute } from "@originloom/react/lib/types";

import { ServerIslandPage } from "~/features/server-island/server-island-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/dummy-seo";
import { defaultPageMeta } from "~/lib/shell-data";

/**
 * A fully cached page with a per-visitor hole in it.
 *
 * The cache key has no visitor dimension — one entry serves everyone — because
 * the personal part is not in this HTML. It arrives as a signed placeholder the
 * server fills afterwards. Compare `/hesabim`, which solves the same problem by
 * shipping a `defer` island: there the component runs in the browser, here it
 * never leaves the server.
 *
 * The payload is signed here, in server code, rather than inside the component:
 * the renderer package cannot reach the server core, and signing is worth
 * seeing at the call site.
 */
export default defineRoute({
  path: "/server-island",
  cache: pageCache(PageCacheId.serverIsland),
  loader: async () => ({
    data: { payload: signServerIslandPayload("visitor-summary", { variant: "full" }) },
  }),
  generateMetadata: (_data, ctx) => ({
    ...generateMetaDataForPageWithDummySeoInfo("/server-island", ctx),
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "server-island", { category: "demo" }),
  Component: ({ data }) => <ServerIslandPage payload={data.payload} />,
});
