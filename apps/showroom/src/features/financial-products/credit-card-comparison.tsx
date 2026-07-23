import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import type { CreditCard, CreditCardComparison } from "~/lib/contracts/financial-products";

import { formatMoney } from "./format";
import { ReferralCta } from "./referral-cta";

export function CreditCardComparisonPage({ data }: { data: CreditCardComparison }) {
  return (
    <div className="space-y-8">
      <header className="max-w-4xl space-y-3">
        <Badge>YAN YANA KARŞILAŞTIRMA</Badge>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">
          Kartların gerçek farkını tek tabloda görün
        </h1>
        <p className="max-w-2xl leading-7 text-slate-600">
          Ücret, gelir koşulu, ödül programı ve kampanya sayısını aynı ölçekte değerlendirin.
        </p>
      </header>

      <ComparisonPicker data={data} />

      <section
        aria-labelledby="comparison-title"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <h2 id="comparison-title" className="sr-only">
          Kredi kartı karşılaştırma sonuçları
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] table-fixed border-collapse text-left">
            <thead>
              <tr className="bg-slate-950 text-white">
                <th className="w-48 p-5 text-sm font-medium text-slate-300" scope="col">
                  Özellik
                </th>
                {data.products.map((card) => (
                  <CardHeading key={card.id} card={card} />
                ))}
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="Yıllık kart ücreti"
                cards={data.products}
                value={(card) => (card.annualFee === 0 ? "Ücretsiz" : formatMoney(card.annualFee))}
              />
              <ComparisonRow
                label="Asgari aylık gelir"
                cards={data.products}
                value={(card) =>
                  card.minMonthlyIncome === 0
                    ? "Gelir koşulu yok"
                    : formatMoney(card.minMonthlyIncome)
                }
              />
              <ComparisonRow
                label="Kart türü"
                cards={data.products}
                value={(card) => card.cardType}
              />
              <ComparisonRow
                label="Ödeme ağı"
                cards={data.products}
                value={(card) => card.network}
              />
              <ComparisonRow
                label="Ödül programı"
                cards={data.products}
                value={(card) => card.rewardProgram}
              />
              <ComparisonRow
                label="Aktif kampanya"
                cards={data.products}
                value={(card) => `${card.campaignCount ?? 0} kampanya`}
              />
              <tr>
                <th
                  className="border-t border-slate-200 bg-slate-50 p-5 text-sm font-semibold"
                  scope="row"
                >
                  Başvuru
                </th>
                {data.products.map((card) => (
                  <td key={card.id} className="border-l border-t border-slate-200 p-5">
                    <div className="flex flex-col items-start gap-2">
                      <ReferralCta
                        productType={card.productType}
                        slug={card.slug}
                        label="Bankaya git"
                        size="sm"
                      />
                      <a
                        className={buttonVariants({ variant: "link", size: "sm" })}
                        href={`/kredi-kartlari/${card.slug}`}
                      >
                        Kart detayları
                      </a>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs leading-5 text-slate-500">
        Karşılaştırma sayfası seçime özel üretildiği için arama motorlarında indekslenmez ve HTML
        cache’e yazılmaz.
      </p>
    </div>
  );
}

function ComparisonPicker({ data }: { data: CreditCardComparison }) {
  return (
    <form
      method="get"
      action="/karsilastir/kredi-kartlari"
      className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
    >
      {[0, 1, 2].map((index) => (
        <label key={index} className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>{index + 1}. kart</span>
          <select
            className={control}
            name="products"
            defaultValue={data.requestedSlugs[index] ?? ""}
            required={index < 2}
          >
            {index === 2 ? <option value="">Üçüncü kart yok</option> : null}
            {data.availableProducts.map((card) => (
              <option key={card.slug} value={card.slug}>
                {card.bank.name} · {card.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button className={buttonVariants()} type="submit">
        Karşılaştır
      </button>
    </form>
  );
}

function CardHeading({ card }: { card: CreditCard }) {
  return (
    <th className="border-l border-slate-700 p-5 align-top" scope="col">
      <p className="text-xs font-medium uppercase tracking-wide text-blue-300">{card.bank.name}</p>
      <p className="mt-2 text-xl font-bold">{card.name}</p>
      <p className="mt-2 text-sm font-normal text-slate-300">{card.summary}</p>
    </th>
  );
}

function ComparisonRow({
  label,
  cards,
  value,
}: {
  label: string;
  cards: CreditCard[];
  value: (card: CreditCard) => string;
}) {
  return (
    <tr>
      <th
        className="border-t border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-700"
        scope="row"
      >
        {label}
      </th>
      {cards.map((card) => (
        <td
          key={card.id}
          className="border-l border-t border-slate-200 p-5 font-medium text-slate-950"
        >
          {value(card)}
        </td>
      ))}
    </tr>
  );
}

const control =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
