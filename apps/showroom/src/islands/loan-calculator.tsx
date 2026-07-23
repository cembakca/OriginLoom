import { clientApiFetch } from "@originloom/react/lib/client/api-fetch";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatMoney } from "~/features/financial-products/format";
import type { LoanCalculatorData } from "~/lib/contracts/financial-products";

export default function LoanCalculatorIsland(initialData: LoanCalculatorData) {
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function calculate(form: HTMLFormElement) {
    const search = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string") search.set(key, value);
    }
    setStatus("loading");
    try {
      const next = await clientApiFetch<LoanCalculatorData>(
        `/api/finance/loan-calculation?${search}`,
      );
      setData(next);
      setStatus("idle");
      window.history.replaceState(null, "", `/araclar/kredi-hesaplama?${search}`);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
      <form
        method="get"
        action="/araclar/kredi-hesaplama"
        className="h-fit space-y-5 rounded-2xl bg-slate-950 p-6 text-white shadow-xl shadow-slate-300/40"
        onSubmit={(event) => {
          event.preventDefault();
          void calculate(event.currentTarget);
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            Hesaplama girdileri
          </p>
          <h2 className="mt-2 text-xl font-semibold">Kredi planınızı oluşturun</h2>
        </div>
        <CalculatorField label="Kredi tutarı" suffix="TL">
          <input
            className={control}
            name="amount"
            type="number"
            min={data.constraints.amount.min}
            max={data.constraints.amount.max}
            step={data.constraints.amount.step}
            defaultValue={data.input.amount}
            required
          />
        </CalculatorField>
        <CalculatorField label="Vade" suffix="ay">
          <select className={control} name="term" defaultValue={data.input.term}>
            {data.constraints.term.options.map((term) => (
              <option key={term} value={term}>
                {term} ay
              </option>
            ))}
          </select>
        </CalculatorField>
        <CalculatorField label="Aylık faiz oranı" suffix="%">
          <input
            className={control}
            name="rate"
            type="number"
            min={data.constraints.monthlyInterestRate.min}
            max={data.constraints.monthlyInterestRate.max}
            step={data.constraints.monthlyInterestRate.step}
            defaultValue={data.input.monthlyInterestRate}
            required
          />
        </CalculatorField>
        <Button className="w-full" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Hesaplanıyor…" : "Ödeme planını hesapla"}
        </Button>
        <p className="min-h-5 text-sm text-rose-200" aria-live="polite">
          {status === "error" ? "Hesaplama şu anda yenilenemedi. Lütfen tekrar deneyin." : ""}
        </p>
      </form>

      <section
        className="space-y-5"
        aria-labelledby="calculation-result"
        aria-busy={status === "loading"}
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge>GATEWAY HESABI</Badge>
              <h2 id="calculation-result" className="mt-3 text-2xl font-bold text-slate-950">
                Aylık {formatMoney(data.result.monthlyPayment)}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {data.input.term} ay · aylık %{data.input.monthlyInterestRate.toFixed(2)} faiz
              </p>
            </div>
            <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-500">
              {data.calculationVersion}
            </span>
          </div>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <ResultMetric label="Kredi tutarı" value={formatMoney(data.input.amount)} />
            <ResultMetric label="Toplam faiz" value={formatMoney(data.result.totalInterest)} />
            <ResultMetric label="Toplam ödeme" value={formatMoney(data.result.totalPayment)} />
          </dl>
        </div>

        <PaymentPlan rows={data.result.paymentPlan} />
        <p className="text-sm leading-6 text-slate-500">{data.disclosure}</p>
      </section>
    </div>
  );
}

function PaymentPlan({ rows }: { rows: LoanCalculatorData["result"]["paymentPlan"] }) {
  return (
    <details className="group rounded-2xl border border-slate-200 bg-white p-5" open>
      <summary className="cursor-pointer font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        Örnek ödeme planı
        <span className="ml-2 text-sm font-normal text-slate-500">({rows.length} taksit)</span>
      </summary>
      <div className="mt-4 max-h-[30rem] overflow-auto">
        <table className="w-full min-w-[38rem] border-collapse text-right text-sm">
          <caption className="sr-only">Aylık kredi ödeme planı</caption>
          <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left" scope="col">
                Taksit
              </th>
              <th className="px-3 py-2" scope="col">
                Anapara
              </th>
              <th className="px-3 py-2" scope="col">
                Faiz
              </th>
              <th className="px-3 py-2" scope="col">
                Ödeme
              </th>
              <th className="px-3 py-2" scope="col">
                Kalan
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.installment} className="border-b border-slate-100">
                <th className="px-3 py-2 text-left font-medium" scope="row">
                  {row.installment}
                </th>
                <td className="px-3 py-2">{formatMoney(row.principal)}</td>
                <td className="px-3 py-2">{formatMoney(row.interest)}</td>
                <td className="px-3 py-2 font-semibold">{formatMoney(row.payment)}</td>
                <td className="px-3 py-2 text-slate-500">{formatMoney(row.remainingPrincipal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function CalculatorField({
  label,
  suffix,
  children,
}: {
  label: string;
  suffix: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-slate-400">{suffix}</span>
      </span>
      {children}
    </label>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 font-bold text-slate-950">{value}</dd>
    </div>
  );
}

const control =
  "h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-base text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30";
