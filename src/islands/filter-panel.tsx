import { useState } from "react";

/**
 * mode="hydrate". Server rendered the shell inside the cached HTML; this
 * wakes it up. Same markup for every visitor, so hydration always matches.
 */
export default function FilterPanel({ amount, city }: { amount: number; city: string }) {
  const [value, setValue] = useState(amount);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        location.href = `/ihtiyac-kredisi/${city}?amount=${value}`;
      }}
    >
      <label>
        Tutar
        <input type="number" value={value} step={5000} onChange={(e) => setValue(Number(e.target.value))} />
      </label>
      <button type="submit">Filtrele</button>
    </form>
  );
}
