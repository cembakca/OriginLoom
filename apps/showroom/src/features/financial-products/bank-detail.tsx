import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import type { BankDetail } from "~/lib/contracts/financial-products";

import { formatMoney } from "./format";
import { ReferralCta } from "./referral-cta";

export function BankDetailPage({ data }: { data: BankDetail }) {
  const productCount = data.products.housingLoans.length + data.products.creditCards.length;
  return (
    <div className="space-y-10">
      <nav aria-label="İçerik yolu" className="text-sm text-slate-500">
        <a className="hover:text-brand-700" href="/">
          Ana Sayfa
        </a>{" "}
        <span aria-hidden="true">/</span> Bankalar <span aria-hidden="true">/</span>{" "}
        {data.bank.name}
      </nav>
      <header className="relative overflow-hidden rounded-3xl bg-slate-950 p-7 text-white md:p-10">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-20 h-64 w-64 rounded-full border-[3rem] border-blue-500/20"
        />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl space-y-4">
            <Badge className="border-blue-400/30 bg-blue-400/10 text-blue-200">BANKA PROFİLİ</Badge>
            <h1 className="text-4xl font-bold tracking-tight md:text-6xl">{data.bank.name}</h1>
            <p className="max-w-2xl text-base leading-7 text-slate-300">{data.bank.description}</p>
          </div>
          <dl className="grid grid-cols-2 gap-6 border-t border-slate-700 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <HeroStat label="Kuruluş" value={String(data.bank.foundedYear)} />
            <HeroStat label="Listelenen ürün" value={String(productCount)} />
            <HeroStat label="Merkez" value={data.bank.headquarters} />
            <HeroStat label="Kanal" value={String(data.bank.customerChannels.length)} />
          </dl>
        </div>
      </header>

      <section aria-labelledby="bank-products" className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
            ÜRÜN KATALOĞU
          </p>
          <h2 id="bank-products" className="mt-1 text-2xl font-bold text-slate-950">
            {data.bank.name} ürünleri
          </h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {data.products.housingLoans.map((loan) => (
            <article
              key={loan.id}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <Badge>KONUT KREDİSİ</Badge>
              <h3 className="mt-4 text-xl font-semibold">
                <a className="hover:text-brand-700" href={`/konut-kredisi/${loan.slug}`}>
                  {loan.name}
                </a>
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{loan.summary}</p>
              <dl className="mt-5 grid grid-cols-3 gap-3">
                <ProductStat label="Faiz" value={`%${loan.interestRate.toFixed(2)}`} />
                <ProductStat label="Aylık" value={formatMoney(loan.calculation.monthlyPayment)} />
                <ProductStat label="Vade" value="120 ay" />
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <a
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  href={`/konut-kredisi/${loan.slug}`}
                >
                  Ürünü incele
                </a>
                <ReferralCta
                  productType={loan.productType}
                  slug={loan.slug}
                  label="Bankaya git"
                  size="sm"
                />
              </div>
            </article>
          ))}
          {data.products.creditCards.map((card) => (
            <article
              key={card.id}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <Badge>KREDİ KARTI</Badge>
              <h3 className="mt-4 text-xl font-semibold">
                <a className="hover:text-brand-700" href={`/kredi-kartlari/${card.slug}`}>
                  {card.name}
                </a>
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{card.summary}</p>
              <dl className="mt-5 grid grid-cols-3 gap-3">
                <ProductStat
                  label="Yıllık ücret"
                  value={card.annualFee === 0 ? "Ücretsiz" : formatMoney(card.annualFee)}
                />
                <ProductStat label="Kampanya" value={String(card.campaignCount ?? 0)} />
                <ProductStat label="Ödeme ağı" value={card.network} />
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <a
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  href={`/kredi-kartlari/${card.slug}`}
                >
                  Kartı incele
                </a>
                <ReferralCta
                  productType={card.productType}
                  slug={card.slug}
                  label="Bankaya git"
                  size="sm"
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <InfoList title="Öne çıkanlar" items={data.highlights} />
        <InfoList title="Müşteri kanalları" items={data.bank.customerChannels} />
      </div>
      <aside className="rounded-xl bg-slate-100 p-5 text-xs leading-5 text-slate-600">
        <strong>Bilgilendirme:</strong> {data.disclosures.join(" ")}
      </aside>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{value}</dd>
    </div>
  );
}
function ProductStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-bold text-slate-950">{value}</dd>
    </div>
  );
}
function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="mt-4 space-y-3 text-sm text-slate-600">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-brand-600" aria-hidden="true">
              ✓
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
