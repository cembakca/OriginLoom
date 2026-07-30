import { Link } from "@originloom/react/lib/link";

import { Badge } from "~/components/ui/badge";
import type { HousingLoanDetail } from "~/lib/contracts/financial-products";

import { formatMoney } from "./format";
import { ReferralCta } from "./referral-cta";

export function HousingLoanDetailPage({ data }: { data: HousingLoanDetail }) {
  const { product } = data;
  return (
    <div className="space-y-8">
      <nav aria-label="İçerik yolu" className="text-sm text-slate-500">
        <Link href="/konut-kredisi" className="hover:text-brand-700">
          Konut Kredileri
        </Link>{" "}
        <span aria-hidden="true">/</span> {product.bank.name}
      </nav>
      <header className="grid gap-8 rounded-2xl bg-slate-950 p-6 text-white md:p-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Badge className="border-emerald-800 bg-emerald-950 text-emerald-200">
            {product.bank.name}
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{product.name}</h1>
          <p className="max-w-2xl leading-7 text-slate-300">{product.summary}</p>
          <ul className="grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
            {product.features.map((item) => (
              <li key={item}>✓ {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-white p-5 text-slate-950">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Örnek ödeme planı
          </p>
          <p className="mt-3 text-3xl font-bold text-brand-700">
            {formatMoney(product.calculation.monthlyPayment)}
          </p>
          <p className="text-sm text-slate-500">aylık · {product.calculation.term} ay</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 text-sm">
            <div>
              <dt className="text-slate-500">Kredi</dt>
              <dd className="font-semibold">{formatMoney(product.calculation.amount)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Aylık faiz</dt>
              <dd className="font-semibold">%{product.interestRate.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Toplam ödeme</dt>
              <dd className="font-semibold">{formatMoney(product.calculation.totalPayment)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Yıllık maliyet</dt>
              <dd className="font-semibold">%{product.annualCostRate.toFixed(2)}</dd>
            </div>
          </dl>
          <ReferralCta
            productType={product.productType}
            slug={product.slug}
            label="Bankada başvur"
            className="mt-5 w-full"
          />
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <InfoList title="Başvuru koşulları" items={product.requirements} />
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold">Masraf özeti</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <Row label="Tahsis ücreti" value={formatMoney(product.calculation.allocationFee)} />
            <Row label="Ekspertiz ücreti" value={formatMoney(product.appraisalFee)} />
            <Row label="Azami kredi/değer" value={`%${product.maxLoanToValue}`} />
          </dl>
        </section>
      </div>
      <aside className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>Bilgilendirme</strong>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {data.disclosures.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <ul className="mt-5 space-y-3 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span aria-hidden="true" className="text-brand-600">
              ●
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-950">{value}</dd>
    </div>
  );
}
