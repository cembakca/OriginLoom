import { Button } from "~/components/ui/button";

export function FilterPanelShell({ amount }: { amount: number }) {
  return (
    <form action="" method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Tutar (TL)
        <input
          type="number"
          name="amount"
          defaultValue={amount}
          step={5000}
          className="h-10 w-40 rounded-md border border-slate-200 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </label>
      <Button type="submit">Filtrele</Button>
    </form>
  );
}
