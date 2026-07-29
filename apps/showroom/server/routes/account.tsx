import { Island } from "@originloom/react/lib/island";
import { defineRoute } from "@originloom/react/lib/types";

import { AccountDashboardShell } from "~/features/account/dashboard-shell";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/dummy-seo";
import { defaultPageMeta } from "~/lib/shell-data";

/** SSR shell — kişisel veri defer island + TanStack Query BFF'den gelir. */
export default defineRoute({
  path: "/hesabim",
  cache: pageCache(PageCacheId.account),
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
