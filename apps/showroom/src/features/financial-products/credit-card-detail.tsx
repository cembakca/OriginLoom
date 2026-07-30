import { Link } from "@originloom/react/lib/link";
import { Suspense, use } from "react";

import { Badge } from "~/components/ui/badge";
import type { CreditCardCampaign, CreditCardDetail } from "~/lib/contracts/financial-products";

import { formatDate, formatMoney } from "./format";
import { ReferralCta } from "./referral-cta";

type CreditCardDetailPageProps = {
  data: {
    detail: CreditCardDetail;
    campaignsPromise: Promise<CreditCardCampaign[]>;
  };
};

export function CreditCardDetailPage({ data }: CreditCardDetailPageProps) {
  const { detail, campaignsPromise } = data;
  const { product } = detail;
  return (
    <div className="space-y-8">
      <nav aria-label="İçerik yolu" className="text-sm text-slate-500">
        <Link href="/kredi-kartlari" className="hover:text-brand-700">
          Kredi Kartları
        </Link>{" "}
        <span aria-hidden="true">/</span> {product.name}
      </nav>
      <header className="grid gap-8 border-b border-slate-200 pb-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
        <div
          aria-hidden="true"
          className="flex aspect-[1.58/1] max-w-sm items-end rounded-2xl bg-slate-950 p-5 text-xl font-bold text-white shadow-xl"
        >
          {product.name}
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge>{product.bank.name}</Badge>
            <Badge>{product.network}</Badge>
            <Badge>{product.annualFee === 0 ? "Aidatsız" : "Ücretli kart"}</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{product.name}</h1>
          <p className="max-w-2xl leading-7 text-slate-600">{product.summary}</p>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <Stat
              label="Yıllık ücret"
              value={product.annualFee === 0 ? "Ücretsiz" : formatMoney(product.annualFee)}
            />
            <Stat label="Ödül programı" value={product.rewardProgram} />
            <Stat label="Kampanya" value={`${product.campaignCount ?? 0} aktif fırsat`} />
          </dl>
          <ReferralCta
            productType={product.productType}
            slug={product.slug}
            label="Bankada hemen başvur"
            size="lg"
          />
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <section aria-labelledby="campaigns" className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
              Güncel avantajlar
            </p>
            <h2 id="campaigns" className="text-2xl font-semibold">
              Kampanyalar
            </h2>
          </div>
          <Suspense fallback={<CampaignListSkeleton />}>
            <CampaignList campaignsPromise={campaignsPromise} />
          </Suspense>
        </section>
        <aside className="space-y-5">
          <Info title="Kart avantajları" items={product.benefits} />
          <Info title="Başvuru koşulları" items={detail.applicationRequirements} />
        </aside>
      </div>
      <aside className="rounded-lg bg-slate-100 p-5 text-xs leading-5 text-slate-600">
        <strong>Önemli bilgiler:</strong> {detail.disclosures.join(" ")}
      </aside>
    </div>
  );
}

function CampaignList({ campaignsPromise }: { campaignsPromise: Promise<CreditCardCampaign[]> }) {
  const campaigns = use(campaignsPromise);
  return campaigns.map((campaign) => (
    <article key={campaign.id} className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge>{campaign.category}</Badge>
          <h3 className="mt-3 text-lg font-semibold">{campaign.title}</h3>
        </div>
        <span className="text-xs text-slate-500">{formatDate(campaign.endsAt)} tarihine kadar</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{campaign.description}</p>
      <p className="mt-3 text-xs font-medium text-slate-500">Katılım: {campaign.participation}</p>
    </article>
  ));
}

function CampaignListSkeleton() {
  return (
    <div aria-label="Kampanyalar yükleniyor" aria-busy="true" className="space-y-4">
      {[1, 2].map((item) => (
        <div key={item} className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
          <div className="h-5 w-24 rounded bg-slate-200" />
          <div className="mt-4 h-6 w-2/3 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-full rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-950">{value}</dd>
    </div>
  );
}
function Info({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
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
