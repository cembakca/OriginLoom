import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { cookie, device, locale } from "../../lib/request";
import { Island } from "../../lib/island";
import { getOffers, type Offer } from "../../services/offers";
import { defaultPageMeta, layoutCacheFragment } from "../../lib/shell-data";
import { publicAbsoluteUrl } from "../../lib/metadata/generate";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { FilterPanelShell } from "./components";

type Data = { offers: Offer[]; amount: number; city: string; theme: string };

export default defineRoute<Data>({
  path: "/ihtiyac-kredisi/:city?",

  cache: (ctx) =>
    sharedUnlessBypass(ctx, [
      "loan",
      ctx.params.city ?? "-",
      ctx.url.searchParams.get("amount") ?? "50000",
      device(ctx.request),
      locale(ctx.request),
      cookie(ctx.request, "theme") ?? "light",
      layoutCacheFragment(ctx),
    ]),

  loader: async (ctx) => {
    const amount = Number(ctx.url.searchParams.get("amount") ?? 50_000);
    const city = ctx.params.city ?? "istanbul";

    return {
      data: {
        offers: await getOffers({ amount, city, device: device(ctx.request) }),
        amount,
        city,
        theme: cookie(ctx.request, "theme") ?? "light",
      },
    };
  },

  generateMetadata: (data, ctx) => {
    const title = `${data.city.charAt(0).toUpperCase()}${data.city.slice(1)} ihtiyaç kredisi`;
    const description = `${data.city} için ${data.offers.length} kredi teklifini karşılaştır.`;
    const url = publicAbsoluteUrl(ctx);
    return { title, description, canonical: url, openGraph: { title, description, url }, twitter: { title, description } };
  },

  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "loan-compare", { category: "credit", mid: "ihtiyac-kredisi", sub: data.city }),

  Component: ({ data }) => (
    <div className="space-y-6" data-theme={data.theme}>
      <div className="space-y-2">
        <Badge>{data.city.toUpperCase()}</Badge>
        <h1 className="text-3xl font-bold capitalize text-slate-900">{data.city} ihtiyaç kredisi</h1>
        <p className="text-slate-600">{data.offers.length} teklif listeleniyor</p>
      </div>

      <Island name="filter-panel" mode="hydrate" props={{ amount: data.amount, city: data.city }}>
        <FilterPanelShell amount={data.amount} />
      </Island>

      <div className="grid gap-4 md:grid-cols-2">
        {data.offers.map((o) => (
          <Card key={o.id} className="hover:border-brand-200 hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{o.bank}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-slate-600">
              <p>
                Faiz: <span className="font-semibold text-brand-700">%{o.rate.toFixed(2)}</span>
              </p>
              <p>
                Aylık:{" "}
                <span className="font-semibold text-slate-900">
                  {o.monthly.toLocaleString("tr-TR")} TL
                </span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  ),
});
