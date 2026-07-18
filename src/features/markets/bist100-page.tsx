import { CatalogPagination } from "~/components/catalog-pagination";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import type { StockList } from "~/lib/contracts/markets";

const number = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

export function Bist100Page({ data }: { data: StockList }) {
  return (
    <div className="space-y-8">
      <header className="grid gap-6 border-b border-slate-200 pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
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
        <div className="text-right text-xs text-slate-500">
          <p>Son güncelleme</p>
          <time dateTime={data.index.asOf}>
            {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(data.index.asOf),
            )}
          </time>
          <p>{data.index.delayedByMinutes} dakika gecikmeli</p>
        </div>
      </header>
      <MarketFilters data={data} />
      <section
        aria-labelledby="stocks-title"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h2 id="stocks-title" className="text-xl font-semibold">
              Hisse listesi
            </h2>
            <p className="text-sm text-slate-500">{data.pagination.total} şirket</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <Th>Hisse</Th>
                <Th>Sektör</Th>
                <Th right>Son fiyat</Th>
                <Th right>Günlük değişim</Th>
                <Th right>Gün içi</Th>
                <Th right>Piyasa değeri</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((stock) => (
                <tr key={stock.symbol} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-4">
                    <strong className="block text-slate-950">{stock.symbol}</strong>
                    <span className="text-xs text-slate-500">{stock.name}</span>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{stock.sector}</td>
                  <td className="px-5 py-4 text-right font-semibold">
                    {number.format(stock.lastPrice)} TL
                  </td>
                  <td
                    className={`px-5 py-4 text-right font-semibold ${stock.changePercent >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {stock.changePercent >= 0 ? "+" : ""}
                    {number.format(stock.changePercent)}%
                  </td>
                  <td className="px-5 py-4 text-right text-xs text-slate-500">
                    {number.format(stock.dayLow)} – {number.format(stock.dayHigh)}
                  </td>
                  <td className="px-5 py-4 text-right">{compact.format(stock.marketCap)} TL</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th scope="col" className={`px-5 py-3 font-semibold ${right ? "text-right" : ""}`}>
      {children}
    </th>
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
