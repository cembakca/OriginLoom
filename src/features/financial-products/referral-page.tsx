import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import type { ReferralDetail } from "~/lib/contracts/financial-products";

export function ReferralPage({ data, publicType }: { data: ReferralDetail; publicType: string }) {
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
        <form method="post" action="/api/referrals" className="space-y-5">
          <input type="hidden" name="productType" value={publicType} />
          <input type="hidden" name="slug" value={data.product.slug} />
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm leading-6 text-slate-700">
            <input
              required
              type="checkbox"
              name="consent"
              value="accepted"
              className="mt-1 h-4 w-4 accent-blue-700"
            />
            <span>
              Başvurunun bankanın kanalında tamamlanacağını ve ürün bilgilerimin yönlendirme
              amacıyla kullanılacağını anladım.
            </span>
          </label>
          <button className={`${buttonVariants({ size: "lg" })} w-full`} type="submit">
            Bankanın başvuru sayfasına git
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          Bu sayfa başvuru sonucu veya kredi onayı garantisi vermez.
        </p>
      </div>
    </div>
  );
}
