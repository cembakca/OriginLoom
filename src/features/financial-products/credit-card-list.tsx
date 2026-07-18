import { CatalogPagination } from "~/components/catalog-pagination";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import type { CreditCardList } from "~/lib/contracts/financial-products";

import { formatMoney } from "./format";

export function CreditCardListPage({ data }: { data: CreditCardList }) {
  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <Badge>KART KARŞILAŞTIRMA</Badge>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
          Harcamalarınıza uygun kredi kartını bulun
        </h1>
        <p className="leading-7 text-slate-600">
          Yıllık ücret, kart türü ve güncel kampanya sayısını karşılaştırın.
        </p>
      </header>
      <CardFilters data={data} />
      <section aria-labelledby="card-results" className="space-y-4">
        <div>
          <h2 id="card-results" className="text-xl font-semibold">
            Kredi kartları
          </h2>
          <p className="text-sm text-slate-500">{data.pagination.total} kart bulundu</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((card, index) => (
            <article
              key={card.id}
              className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[8rem_1fr]"
            >
              <div
                aria-hidden="true"
                className={`flex aspect-[1.58/1] items-end rounded-xl p-3 text-sm font-bold text-white shadow-sm ${index % 2 === 0 ? "bg-slate-950" : "bg-brand-700"}`}
              >
                {card.name}
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-slate-500">
                    {card.bank.name} · {card.network}
                  </p>
                  <h3 className="text-lg font-semibold">
                    <a href={`/kredi-kartlari/${card.slug}`} className="hover:text-brand-700">
                      {card.name}
                    </a>
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>
                    {card.annualFee === 0 ? "Aidatsız" : `${formatMoney(card.annualFee)} / yıl`}
                  </Badge>
                  <Badge>{card.campaignCount ?? 0} kampanya</Badge>
                </div>
                <p className="text-sm leading-6 text-slate-600">{card.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <a
                    className={buttonVariants({ size: "sm" })}
                    href={`/kredi-kartlari/${card.slug}`}
                  >
                    Detay ve kampanyalar
                  </a>
                  <a
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    href={`/basvuru/kredi-karti/${card.slug}/yonlendirme`}
                  >
                    Başvur
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
        <CatalogPagination
          pathname="/kredi-kartlari"
          search={cardSearch(data)}
          page={data.pagination.page}
          totalPages={data.pagination.totalPages}
        />
      </section>
    </div>
  );
}

function CardFilters({ data }: { data: CreditCardList }) {
  return (
    <form
      method="get"
      action="/kredi-kartlari"
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2 lg:grid-cols-5"
    >
      <Field label="Banka">
        <select className={control} name="bank" defaultValue={data.query.bank ?? ""}>
          <option value="">Tüm bankalar</option>
          {data.facets.banks.map((bank) => (
            <option key={bank.value} value={bank.value}>
              {bank.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Kart türü">
        <select className={control} name="cardType" defaultValue={data.query.cardType}>
          <option value="all">Tümü</option>
          <option value="classic">Klasik</option>
          <option value="premium">Premium</option>
          <option value="student">Öğrenci</option>
          <option value="no-fee">Aidatsız</option>
          <option value="digital">Dijital</option>
        </select>
      </Field>
      <Field label="Yıllık ücret">
        <select className={control} name="annualFee" defaultValue={data.query.annualFee}>
          <option value="all">Tümü</option>
          <option value="free">Ücretsiz</option>
          <option value="paid">Ücretli</option>
        </select>
      </Field>
      <Field label="Sıralama">
        <select className={control} name="sortBy" defaultValue={data.query.sortBy}>
          <option value="recommended">Önerilen</option>
          <option value="annual-fee-asc">Ücret: düşükten</option>
          <option value="campaign-count-desc">Kampanya sayısı</option>
        </select>
      </Field>
      <button className={`${buttonVariants()} self-end`} type="submit">
        Filtrele
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
function cardSearch(data: CreditCardList) {
  const search = new URLSearchParams({
    cardType: data.query.cardType,
    annualFee: data.query.annualFee,
    network: data.query.network,
    sortBy: data.query.sortBy,
  });
  if (data.query.bank) search.set("bank", data.query.bank);
  return search;
}
const control =
  "mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
