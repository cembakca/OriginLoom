import { getOffers } from "@server/services/offers";
import { isKnownLoanCity } from "@server/services/route-domains";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { parseLoanAmount, parseTheme } from "~/lib/content-values";
import type { Offer } from "~/lib/contracts/offers";
import { Island } from "~/lib/island";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { cookie, device } from "~/lib/request";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";
import { FilterPanelShell } from "~/routes/loan-compare/components";

type Data = { offers: Offer[]; amount: number; city: string; theme: string };

export default defineRoute<Data>({
  path: "/ihtiyac-kredisi/:city?",

  validateParams: (ctx) => isKnownLoanCity(ctx.params.city ?? "istanbul"),

  cache: (ctx) => pageCachePolicy(PageCacheId.loanCompare, ctx),

  loader: async (ctx) => {
    const amount = parseLoanAmount(ctx.url.searchParams.get("amount"));
    const city = ctx.params.city ?? "istanbul";

    return {
      data: {
        offers: await getOffers(ctx.request, { amount, city, device: device(ctx.request) }),
        amount,
        city,
        theme: parseTheme(cookie(ctx.request, "theme")),
      },
    };
  },

  generateMetadata: (data, ctx) => {
    const title = `${data.city.charAt(0).toUpperCase()}${data.city.slice(1)} ihtiyaç kredisi`;
    const description = `${data.city} için ${data.offers.length} kredi teklifini karşılaştır.`;
    const url = publicAbsoluteUrl(ctx);
    return {
      title,
      description,
      canonical: url,
      openGraph: { title, description, url },
      twitter: { title, description },
    };
  },

  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "loan-compare", {
      category: "credit",
      mid: "ihtiyac-kredisi",
      sub: data.city,
    }),

  Component: ({ data }) => (
    <div className="space-y-6" data-theme={data.theme}>
      <div className="space-y-2">
        <Badge>{data.city.toUpperCase()}</Badge>
        <h1 className="text-3xl font-bold capitalize text-slate-900">
          {data.city} ihtiyaç kredisi
        </h1>
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
