import { defineRoute } from "../../lib/types";
import { cookie, device, locale } from "../../lib/request";
import { Island } from "../../lib/island";
import { getOffers, type Offer } from "../../services/offers";
import { SiteHeader } from "../../components/layout/site-header";
import { FilterPanelShell } from "./components";

type Data = { offers: Offer[]; amount: number; city: string; theme: string };

export default defineRoute<Data>({
  path: "/ihtiyac-kredisi/:city?",

  /**
   * Reads three headers and two cookies. Runs before the loader. Pure.
   *
   * `theme` goes in the key   -> 2 variants of the HTML exist.
   * `sid`   does NOT go in    -> logged-in and anonymous visitors get the
   *                             SAME cached HTML. Reading it here costs
   *                             nothing and demotes nothing.
   */
  cache: (ctx) => ({
    kind: "shared",
    ttl: 300,
    swr: 86_400,
    key: [
      "loan",
      ctx.params.city ?? "-",
      ctx.url.searchParams.get("amount") ?? "50000",
      device(ctx.request),
      locale(ctx.request),
      cookie(ctx.request, "theme") ?? "light",
    ],
  }),

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

  title: (d) => `${d.city} ihtiyaç kredisi — ${d.offers.length} teklif`,

  Component: ({ data }) => (
    <main data-theme={data.theme}>
      <SiteHeader />

      <h1>{data.city} ihtiyaç kredisi</h1>

      {/* Interactive but identical for everyone. Rendered, then hydrated. */}
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
    </main>
  ),
});
