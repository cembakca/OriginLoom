import type { UserProfile } from "../../services/user";
import { fetchUserProfile } from "../../services/user";
import { defineRoute } from "../../lib/types";
import { neverCache } from "../../lib/cache-policy";
import { defaultPageMeta } from "../../lib/shell-data";
import { generateMetaDataForPageWithDummySeoInfo } from "../../lib/metadata/generate";

type Data = {
  user: UserProfile | null;
};

export default defineRoute<Data>({
  path: "/hesabim",
  cache: () => neverCache(),
  loader: async (ctx) => {
    const user = await fetchUserProfile(ctx.request);
    if (!user) return { data: { user: null }, status: 401 };
    return { data: { user } };
  },
  generateMetadata: (data, ctx) => ({
    ...generateMetaDataForPageWithDummySeoInfo("/hesabim", ctx),
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "account", { category: "account" }),
  Component: ({ data }) =>
    data.user ? (
      <>
        <h1>Hesabım</h1>
        <p>Hoş geldin, {data.user.displayName}</p>
      </>
    ) : (
      <>
        <h1>Giriş gerekli</h1>
        <p>
          Oturum açmak için <code>access_token</code> veya <code>refresh_token</code> cookie kullanın.
        </p>
      </>
    ),
});
