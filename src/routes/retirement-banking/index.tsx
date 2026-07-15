import type { UserProfile } from "../../services/user";
import { fetchUserProfile } from "../../services/user";
import { fetchRetirementBankingPage } from "../../services/pages";
import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { locale } from "../../lib/request";
import { defaultPageMeta, layoutCacheFragment } from "../../lib/shell-data";
import {
  generateMetaDataForPageWithDummySeoInfo,
  generateMetaDataForPageWithSeoInfo,
} from "../../lib/metadata/generate";
import type { SeoInfo } from "../../lib/metadata/types";

type Data = {
  publicPath: string;
  user: UserProfile | null;
  headline: string;
  authenticated: boolean;
  seoInfo: SeoInfo | null;
};

export default defineRoute<Data>({
  path: "/retirement-banking",

  cache: (ctx) =>
    sharedUnlessBypass(ctx, ["retirement-banking", ctx.publicPath, locale(ctx.request), layoutCacheFragment(ctx)], {
      ttl: 3600,
    }),

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
    <>
      <h1>{data.headline}</h1>
      <p>
        Internal route: <code>/retirement-banking</code>
      </p>
      <p>
        Public URL: <code>{data.publicPath}</code>
      </p>
      <p>
        Gateway auth: {data.authenticated ? "Bearer token iletildi" : "anonim"}
      </p>
      <p style={{ color: "#64748b" }}>
        Anonim ziyaretçi cache HIT alır; token varsa BYPASS — kişisel SSR + gateway.
      </p>
    </>
  ),
});
