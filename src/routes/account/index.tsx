import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { Island } from "~/lib/island";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";

import { AccountDashboardShell } from "./dashboard-shell";

/** SSR shell — kişisel veri defer island + TanStack Query BFF'den gelir. */
export default defineRoute({
  path: "/hesabim",
  cache: (ctx) => pageCachePolicy(PageCacheId.account, ctx),
  loader: async () => ({ data: {} }),
  generateMetadata: (_data, ctx) => ({
    ...generateMetaDataForPageWithDummySeoInfo("/hesabim", ctx),
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "account", { category: "account" }),
  Component: () => (
    <Island name="account-dashboard" mode="defer">
      <AccountDashboardShell />
    </Island>
  ),
});
