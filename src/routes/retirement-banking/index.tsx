import type { UserProfile } from "../../services/user";
import { fetchRetirementBankingContent, fetchUserProfile } from "../../services/user";
import { SiteHeader } from "../../components/layout/site-header";
import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { locale } from "../../lib/request";

type Data = {
  publicPath: string;
  user: UserProfile | null;
  headline: string;
  authenticated: boolean;
};

export default defineRoute<Data>({
  path: "/retirement-banking",

  cache: (ctx) =>
    sharedUnlessBypass(ctx, ["retirement-banking", ctx.publicPath, locale(ctx.request)], {
      ttl: 3600,
    }),

  loader: async (ctx) => {
    const [user, content] = await Promise.all([
      fetchUserProfile(ctx.request),
      fetchRetirementBankingContent(ctx.request),
    ]);

    return {
      data: {
        publicPath: ctx.publicPath,
        user,
        headline: content.headline,
        authenticated: content.authenticated,
      },
    };
  },

  title: () => "Emekli Bankacılığı",

  Component: ({ data }) => (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <SiteHeader user={data.user} />

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
    </main>
  ),
});
