import { Island } from "@originloom/react/lib/island";

import { CatalogPagination } from "~/components/catalog-pagination";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { MarketLiveTable } from "~/features/markets/market-live-table";
import type { StockList } from "~/lib/contracts/markets";

export function Bist100Page({ data }: { data: StockList }) {
  return (
    <div className="space-y-8">
      <header className="border-b border-slate-200 pb-8">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Badge>{data.index.code}</Badge>
            <Badge
              className={
                data.index.marketStatus === "open"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : ""
              }
            >
              {data.index.marketStatus === "open" ? "Piyasa açık" : "Piyasa kapalı"}
            </Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">BIST 100 hisseleri</h1>
          <p className="max-w-2xl leading-7 text-slate-600">
            Endeks şirketlerini fiyat, günlük değişim, sektör ve piyasa değerine göre inceleyin.
          </p>
        </div>
      </header>
      <MarketFilters data={data} />
      <Island
        name="market-live"
        eager
        props={{
          initialStocks: data.items,
          initialAsOf: data.index.asOf,
          delayedByMinutes: data.index.delayedByMinutes,
        }}
      >
        <MarketLiveTable
          stocks={data.items}
          asOf={data.index.asOf}
          delayedByMinutes={data.index.delayedByMinutes}
          status="connecting"
        />
      </Island>
      <CatalogPagination
        pathname="/piyasalar/bist-100"
        search={stockSearch(data)}
        page={data.pagination.page}
        totalPages={data.pagination.totalPages}
      />
      <p className="rounded-lg bg-slate-100 p-4 text-xs leading-5 text-slate-600">
        {data.disclaimer}
      </p>
    </div>
  );
}

function MarketFilters({ data }: { data: StockList }) {
  return (
    <form
      method="get"
      action="/piyasalar/bist-100"
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-[1fr_1fr_1fr_auto]"
    >
      <label className="text-sm font-medium text-slate-700">
        Hisse ara
        <input
          name="q"
          defaultValue={data.query.q ?? ""}
          placeholder="THYAO veya şirket adı"
          className={control}
        />
      </label>
      <label className="text-sm font-medium text-slate-700">
        Sektör
        <select name="sector" defaultValue={data.query.sector ?? ""} className={control}>
          <option value="">Tüm sektörler</option>
          {data.facets.sectors.map((sector) => (
            <option key={sector} value={sector.toLocaleLowerCase("tr-TR")}>
              {sector}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700">
        Sıralama
        <select name="sortBy" defaultValue={data.query.sortBy} className={control}>
          <option value="market-cap-desc">Piyasa değeri</option>
          <option value="symbol-asc">Sembol A–Z</option>
          <option value="price-desc">Fiyat</option>
          <option value="change-desc">En çok yükselen</option>
          <option value="change-asc">En çok düşen</option>
        </select>
      </label>
      <button className={`${buttonVariants()} self-end`} type="submit">
        Uygula
      </button>
    </form>
  );
}
function stockSearch(data: StockList) {
  const search = new URLSearchParams({ sortBy: data.query.sortBy });
  if (data.query.q) search.set("q", data.query.q);
  if (data.query.sector) search.set("sector", data.query.sector);
  return search;
}
const control =
  "mt-1.5 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
