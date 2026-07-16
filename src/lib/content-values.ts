export type Theme = "light" | "dark";

const DEFAULT_LOAN_AMOUNT = 50_000;
const MIN_LOAN_AMOUNT = 1_000;
const MAX_LOAN_AMOUNT = 1_000_000;

export function parseLoanAmount(raw: string | null): number {
  const parsed = Number(raw ?? DEFAULT_LOAN_AMOUNT);
  if (!Number.isFinite(parsed)) return DEFAULT_LOAN_AMOUNT;
  return Math.min(MAX_LOAN_AMOUNT, Math.max(MIN_LOAN_AMOUNT, Math.round(parsed)));
}

export function parsePage(raw: string | null): number {
  const parsed = Number(raw ?? 1);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "dark" ? "dark" : "light";
}
