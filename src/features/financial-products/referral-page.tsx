import { Badge } from "~/components/ui/badge";
import type { ReferralDetail } from "~/lib/contracts/financial-products";

import { ReferralCta } from "./referral-cta";

export function ReferralPage({ data }: { data: ReferralDetail }) {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <Badge>GÜVENLİ YÖNLENDİRME</Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">{data.product.name} başvurusu</h1>
        <p className="mt-3 leading-7 text-slate-600">{data.disclosure}</p>
        <div className="my-6 rounded-xl bg-slate-950 p-5 text-white">
          <p className="text-xs uppercase tracking-widest text-slate-400">Seçilen ürün</p>
          <p className="mt-2 text-xl font-semibold">{data.product.name}</p>
          <p className="text-sm text-slate-300">{data.product.bank.name}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4 text-sm leading-6 text-slate-700">
          Tıklamanızla birlikte kişisel başvuru bilgisi paylaşmadan bankanın güvenli kanalına
          yönlendirilirsiniz. Başvuru bankanın sayfasında tamamlanır.
        </div>
        <ReferralCta
          productType={data.product.productType}
          slug={data.product.slug}
          label="Bankanın başvuru sayfasına git"
          size="lg"
          className="mt-5 w-full"
        />
        <p className="mt-4 text-center text-xs text-slate-500">
          Bu sayfa başvuru sonucu veya kredi onayı garantisi vermez.
        </p>
      </div>
    </div>
  );
}
