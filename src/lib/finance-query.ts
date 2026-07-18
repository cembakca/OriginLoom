import { parsePage } from "./content-values";

const CITY = new Set(["istanbul", "ankara", "izmir", "bursa", "antalya"]);
const LOAN_SORT = new Set([
  "recommended",
  "interest-rate-asc",
  "monthly-payment-asc",
  "total-payment-asc",
]);
const CARD_TYPE = new Set(["all", "classic", "premium", "student", "no-fee", "digital"]);
const FEE = new Set(["all", "free", "paid"]);
const NETWORK = new Set(["all", "Visa", "Mastercard", "TROY"]);
const CARD_SORT = new Set(["recommended", "annual-fee-asc", "campaign-count-desc"]);
const TERM = new Set([12, 24, 36, 48, 60, 84, 120]);

const number = (raw: string | null, fallback: number, min: number, max: number) => {
  const value = Number(raw);
  return String(
    Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback,
  );
};
const value = (raw: string | null, allowed: Set<string>, fallback: string) =>
  raw && allowed.has(raw) ? raw : fallback;
const slug = (raw: string | null) =>
  raw && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) && raw.length <= 80 ? raw : "-";

export const financeQueryNormalizers: Record<string, (raw: string | null) => string> = {
  amount: (raw) => number(raw, 2_000_000, 100_000, 10_000_000),
  term: (raw) => {
    const parsed = Number(raw);
    return String(TERM.has(parsed) ? parsed : 120);
  },
  city: (raw) => value(raw, CITY, "istanbul"),
  bank: slug,
  sortBy: (raw) => value(raw, new Set([...LOAN_SORT, ...CARD_SORT]), "recommended"),
  page: (raw) => String(parsePage(raw)),
  cardType: (raw) => value(raw, CARD_TYPE, "all"),
  annualFee: (raw) => value(raw, FEE, "all"),
  network: (raw) => value(raw, NETWORK, "all"),
};

export function normalizedSearch(url: URL, names: readonly string[]): URLSearchParams {
  const search = new URLSearchParams();
  for (const name of names) {
    const normalize = financeQueryNormalizers[name];
    if (!normalize) continue;
    const normalized = normalize(url.searchParams.get(name));
    if (normalized !== "-") search.set(name, normalized);
  }
  return search;
}
