import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { cookie, device, locale } from "../../lib/request";
import { Island } from "../../lib/island";
import { getOffers, type Offer } from "../../services/offers";
import { defaultPageMeta } from "../../lib/shell-data";
import { publicAbsoluteUrl } from "../../lib/metadata/generate";
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
    <div data-theme={data.theme}>
      <h1>{data.city} ihtiyaç kredisi</h1>

      <Island name="filter-panel" mode="hydrate" props={{ amount: data.amount, city: data.city }}>
        <FilterPanelShell amount={data.amount} />
      </Island>

      <ul>
        {data.offers.map((o) => (
          <li key={o.id}>
            <strong>{o.bank}</strong> — %{o.rate.toFixed(2)} — aylık {o.monthly.toLocaleString("tr-TR")} TL
          </li>
        ))}
      </ul>
    </div>
  ),
});
