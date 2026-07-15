import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";
import type { UserProfile } from "~/services/user";
import { fetchUserProfile } from "~/services/user";

type Data = { user: UserProfile | null };

export default defineRoute<Data>({
  path: "/hesabim",
  cache: (ctx) => pageCachePolicy(PageCacheId.account, ctx),
  loader: async (ctx) => {
    const user = await fetchUserProfile(ctx.request);
    if (!user) return { data: { user: null }, status: 401 };
    return { data: { user } };
  },
  generateMetadata: (_data, ctx) => ({
    ...generateMetaDataForPageWithDummySeoInfo("/hesabim", ctx),
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "account", { category: "account" }),
  Component: ({ data }) =>
    data.user ? (
      <Card className="max-w-lg">
        <CardContent className="space-y-2 pt-6">
          <Badge>Hesap</Badge>
          <h1 className="text-2xl font-bold">Hesabım</h1>
          <p className="text-slate-600">
            Hoş geldin,{" "}
            <span className="font-semibold text-slate-900">{data.user.displayName}</span>
          </p>
        </CardContent>
      </Card>
    ) : (
      <Card className="max-w-lg border-amber-200 bg-amber-50">
        <CardContent className="space-y-2 pt-6">
          <h1 className="text-2xl font-bold text-amber-950">Giriş gerekli</h1>
          <p className="text-sm text-amber-900/80">
            Oturum açmak için <code className="rounded bg-white/80 px-1">access_token</code> veya{" "}
            <code className="rounded bg-white/80 px-1">refresh_token</code> cookie ekleyin.
          </p>
        </CardContent>
      </Card>
    ),
});
