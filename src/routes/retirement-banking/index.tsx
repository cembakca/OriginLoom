import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import {
  generateMetaDataForPageWithDummySeoInfo,
  generateMetaDataForPageWithSeoInfo,
} from "~/lib/metadata/generate";
import type { SeoInfo } from "~/lib/metadata/types";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";
import { fetchRetirementBankingPage } from "~/services/pages";
import type { UserProfile } from "~/services/user";
import { fetchUserProfile } from "~/services/user";

type Data = {
  publicPath: string;
  user: UserProfile | null;
  headline: string;
  authenticated: boolean;
  seoInfo: SeoInfo | null;
};

export default defineRoute<Data>({
  path: "/retirement-banking",

  cache: (ctx) => pageCachePolicy(PageCacheId.retirementBanking, ctx),

  loader: async (ctx) => {
    const [user, page] = await Promise.all([
      fetchUserProfile(ctx.request),
      fetchRetirementBankingPage(ctx.request),
    ]);

    return {
      data: {
        publicPath: ctx.publicPath,
        user,
        headline: page.headline,
        authenticated: page.authenticated,
        seoInfo: page.seoInfo,
      },
    };
  },

  generateMetadata: (data, ctx) =>
    data.seoInfo
      ? generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx)
      : generateMetaDataForPageWithDummySeoInfo("/retirement-banking", ctx),

  pageMeta: (_data, ctx) =>
    defaultPageMeta(ctx, "retirement-banking", {
      category: "banking",
      mid: "emekli",
      title: "Emekli Bankacılığı",
    }),

  Component: ({ data }) => (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">{data.headline}</h1>
        <p className="text-slate-600">
          Gateway auth: {data.authenticated ? "Bearer token iletildi" : "anonim"}
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 space-y-1">
        <p>
          Internal: <code className="rounded bg-white px-1.5 py-0.5">/retirement-banking</code>
        </p>
        <p>
          Public: <code className="rounded bg-white px-1.5 py-0.5">{data.publicPath}</code>
        </p>
        <p className="text-slate-500">Anonim cache HIT; token → BYPASS</p>
      </div>
    </div>
  ),
});
