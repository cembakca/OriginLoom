import { CatalogPagination } from "~/components/catalog-pagination";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import type { HousingLoanList } from "~/lib/contracts/financial-products";

import { formatMoney } from "./format";

export function HousingLoanListPage({ data }: { data: HousingLoanList }) {
  const search = loanSearch(data);
  return (
    <div className="space-y-8">
      <header className="grid gap-6 border-b border-slate-200 pb-8 lg:grid-cols-[1.4fr_0.6fr] lg:items-end">
        <div className="space-y-3">
          <Badge>KONUT FİNANSMANI</Badge>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            Konut kredilerini aynı hesapla karşılaştırın
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            Faiz oranını, aylık taksiti ve toplam geri ödemeyi tek tabloda görün.
          </p>
        </div>
        <div className="rounded-lg border border-slate-300 bg-slate-950 p-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Hesap özeti
          </p>
          <p className="mt-2 text-2xl font-bold">{formatMoney(data.query.amount)}</p>
          <p className="text-sm text-slate-300">
            {data.query.term} ay · {cityLabel(data.query.city)}
          </p>
        </div>
      </header>

      <LoanFilters data={data} />

      <section aria-labelledby="loan-results" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="loan-results" className="text-xl font-semibold text-slate-950">
              Kredi seçenekleri
            </h2>
            <p className="text-sm text-slate-500">{data.pagination.total} ürün bulundu</p>
          </div>
          <p className="text-xs text-slate-500">Oranlar örnek gateway verisidir.</p>
        </div>
        <div className="space-y-3">
          {data.items.map((loan) => (
            <article
              key={loan.id}
              className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1.1fr_1fr_auto] md:items-center"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {loan.badges.map((badge) => (
                    <Badge key={badge}>{badge}</Badge>
                  ))}
                </div>
                <p className="text-sm font-medium text-slate-500">{loan.bank.name}</p>
                <h3 className="text-lg font-semibold text-slate-950">
                  <a
                    className="hover:text-brand-700"
                    href={`/konut-kredisi/${loan.slug}?amount=${data.query.amount}&term=${data.query.term}`}
                  >
                    {loan.name}
                  </a>
                </h3>
                <p className="text-sm leading-6 text-slate-600">{loan.summary}</p>
              </div>
              <dl className="grid grid-cols-3 gap-3 border-y border-slate-100 py-4 md:border-y-0 md:border-l md:py-0 md:pl-5">
                <Metric label="Faiz" value={`%${loan.interestRate.toFixed(2)}`} accent />
                <Metric label="Aylık" value={formatMoney(loan.calculation.monthlyPayment)} />
                <Metric label="Toplam" value={formatMoney(loan.calculation.totalPayment)} />
              </dl>
              <a
                className={buttonVariants()}
                href={`/konut-kredisi/${loan.slug}?amount=${data.query.amount}&term=${data.query.term}`}
              >
                İncele
              </a>
            </article>
          ))}
        </div>
        <CatalogPagination
          pathname="/konut-kredisi"
          search={search}
          page={data.pagination.page}
          totalPages={data.pagination.totalPages}
        />
      </section>
    </div>
  );
}

function LoanFilters({ data }: { data: HousingLoanList }) {
  return (
    <form
      method="get"
      action="/konut-kredisi"
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2 lg:grid-cols-5"
    >
      <Field label="Kredi tutarı">
        <input
          className={control}
          type="number"
          name="amount"
          min="100000"
          max="10000000"
          step="50000"
          defaultValue={data.query.amount}
        />
      </Field>
      <Field label="Vade">
        <select className={control} name="term" defaultValue={data.query.term}>
          {data.facets.terms.map((term) => (
            <option key={term} value={term}>
              {term} ay
            </option>
          ))}
        </select>
      </Field>
      <Field label="Şehir">
        <select className={control} name="city" defaultValue={data.query.city}>
          {data.facets.cities.map((city) => (
            <option key={city} value={city}>
              {cityLabel(city)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sıralama">
        <select className={control} name="sortBy" defaultValue={data.query.sortBy}>
          <option value="recommended">Önerilen</option>
          <option value="interest-rate-asc">Faiz: düşükten</option>
          <option value="monthly-payment-asc">Aylık ödeme: düşükten</option>
          <option value="total-payment-asc">Toplam ödeme: düşükten</option>
        </select>
      </Field>
      <button className={`${buttonVariants()} self-end`} type="submit">
        Hesapla
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm font-bold ${accent ? "text-brand-700" : "text-slate-950"}`}>
        {value}
      </dd>
    </div>
  );
}

function loanSearch(data: HousingLoanList) {
  const search = new URLSearchParams({
    amount: String(data.query.amount),
    term: String(data.query.term),
    city: data.query.city,
    sortBy: data.query.sortBy,
  });
  if (data.query.bank) search.set("bank", data.query.bank);
  return search;
}

function cityLabel(value: string) {
  return value.charAt(0).toLocaleUpperCase("tr-TR") + value.slice(1);
}

const control =
  "mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
