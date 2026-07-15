import { useState } from "react";

import { Button } from "~/components/ui/button";

/** mode="hydrate" — shell markup FilterPanelShell ile uyumlu. */
export default function FilterPanel({ amount, city }: { amount: number; city: string }) {
  const [value, setValue] = useState(amount);

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        location.href = `/ihtiyac-kredisi/${city}?amount=${value}`;
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Tutar (TL)
        <input
          type="number"
          value={value}
          step={5000}
          onChange={(e) => setValue(Number(e.target.value))}
          className="h-10 w-40 rounded-md border border-slate-200 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </label>
      <Button type="submit">Filtrele</Button>
    </form>
  );
}
