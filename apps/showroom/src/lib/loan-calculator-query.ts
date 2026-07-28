export const loanCalculatorDefaults = {
  amount: 2_000_000,
  term: 120,
  rate: 2.99,
} as const;

export const loanCalculatorTerms = [12, 24, 36, 48, 60, 84, 120] as const;

export function parseLoanCalculatorSearch(search: URLSearchParams): URLSearchParams | null {
  const amount = parseInteger(search.get("amount"), loanCalculatorDefaults.amount);
  const term = parseInteger(search.get("term"), loanCalculatorDefaults.term);
  const rate = parseRate(search.get("rate"), loanCalculatorDefaults.rate);
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(term) ||
    !Number.isFinite(rate) ||
    amount < 100_000 ||
    amount > 10_000_000 ||
    !loanCalculatorTerms.some((option) => option === term) ||
    rate < 0.01 ||
    rate > 20
  )
    return null;
  return new URLSearchParams({ amount: String(amount), term: String(term), rate: String(rate) });
}

function parseInteger(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

function parseRate(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  return /^\d+(?:\.\d{1,2})?$/.test(value) ? Number(value) : Number.NaN;
}
