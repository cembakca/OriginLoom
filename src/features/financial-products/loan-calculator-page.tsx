import { Island } from "@originloom/react/lib/island";

import { Badge } from "~/components/ui/badge";
import LoanCalculatorIsland from "~/islands/loan-calculator";
import type { LoanCalculatorData } from "~/lib/contracts/financial-products";

export function LoanCalculatorPage({ data }: { data: LoanCalculatorData }) {
  return (
    <div className="space-y-8">
      <header className="grid gap-5 border-b border-slate-200 pb-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
        <div className="space-y-3">
          <Badge>FİNANS ARAÇLARI</Badge>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">
            Kredi taksidini değil, ödeme planının tamamını görün
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            Tutar, vade ve aylık faiz oranını girin; gateway tarafından hesaplanan taksitleri ve
            anapara-faiz dağılımını inceleyin.
          </p>
        </div>
        <p className="border-l-4 border-brand-500 pl-4 text-sm leading-6 text-slate-500">
          JavaScript kapalıyken de form sunucuda çalışır. Etkileşim açıldığında aynı finans kuralı
          BFF üzerinden çağrılır.
        </p>
      </header>
      <Island name="loan-calculator" mode="hydrate" props={data} eager>
        <LoanCalculatorIsland {...data} />
      </Island>
    </div>
  );
}
