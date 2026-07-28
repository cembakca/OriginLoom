import type { Stock } from "~/lib/contracts/markets";

export type MarketStreamStatus = "connecting" | "live" | "paused" | "reconnecting" | "offline";

const number = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const timestamp = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Europe/Istanbul",
});

export function MarketLiveTable({
  stocks,
  asOf,
  delayedByMinutes,
  status,
}: {
  stocks: Stock[];
  asOf: string;
  delayedByMinutes: number;
  status: MarketStreamStatus;
}) {
  return (
    <section
      aria-labelledby="stocks-title"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5">
        <div>
          <h2 id="stocks-title" className="text-xl font-semibold">
            Hisse listesi
          </h2>
          <p className="text-sm text-slate-500">{stocks.length} şirket bu sayfada</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p className="flex items-center justify-end gap-2" aria-live="polite">
            <span className={`size-2 rounded-full ${statusColor(status)}`} aria-hidden="true" />
            <span>{statusLabel(status)}</span>
          </p>
          <time dateTime={asOf}>{timestamp.format(new Date(asOf))}</time>
          <p>{delayedByMinutes} dakika gecikmeli veri</p>
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
            {stocks.map((stock) => (
              <tr
                key={stock.symbol}
                data-market-symbol={stock.symbol}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-5 py-4">
                  <strong className="block text-slate-950">{stock.symbol}</strong>
                  <span className="text-xs text-slate-500">{stock.name}</span>
                </td>
                <td className="px-5 py-4 text-slate-600">{stock.sector}</td>
                <td className="px-5 py-4 text-right font-semibold" data-market-price="">
                  {number.format(stock.lastPrice)} TL
                </td>
                <td
                  data-market-change=""
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
  );
}

function statusLabel(status: MarketStreamStatus): string {
  if (status === "live") return "Canlı akış bağlı";
  if (status === "paused") return "Sekme arka planda — akış duraklatıldı";
  if (status === "reconnecting") return "Canlı akış yeniden bağlanıyor";
  if (status === "offline") return "Ağ çevrimdışı — son snapshot gösteriliyor";
  return "Canlı akış bağlanıyor";
}

function statusColor(status: MarketStreamStatus): string {
  if (status === "live") return "bg-emerald-500";
  if (status === "offline") return "bg-rose-500";
  if (status === "paused") return "bg-slate-400";
  return "bg-amber-500";
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th scope="col" className={`px-5 py-3 font-semibold ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}
