export type Theme = "light" | "dark";

const DEFAULT_LOAN_AMOUNT = 50_000;
const MIN_LOAN_AMOUNT = 1_000;
const MAX_LOAN_AMOUNT = 1_000_000;
export const MAX_PAGE = 1_000;
export const MAX_ROUTE_SLUG_LENGTH = 64;

export type PageParamResolution =
  { kind: "valid"; page: number } | { kind: "redirect"; page: number } | { kind: "invalid" };

export function parseLoanAmount(raw: string | null): number {
  const parsed = Number(raw ?? DEFAULT_LOAN_AMOUNT);
  if (!Number.isFinite(parsed)) return DEFAULT_LOAN_AMOUNT;
  return Math.min(MAX_LOAN_AMOUNT, Math.max(MIN_LOAN_AMOUNT, Math.round(parsed)));
}

export function parsePage(raw: string | null): number {
  const parsed = Number(raw ?? 1);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(MAX_PAGE, Math.floor(parsed));
}

/**
 * Public page query contract. Missing page means canonical page 1; explicit
 * page=1 and zero-padded values redirect; malformed/out-of-range values 404.
 */
export function resolvePageParam(raw: string | null): PageParamResolution {
  if (raw === null) return { kind: "valid", page: 1 };
  if (!/^\d+$/.test(raw)) return { kind: "invalid" };

  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) return { kind: "invalid" };
  if (page === 1 || raw !== String(page)) return { kind: "redirect", page };
  return { kind: "valid", page };
}

/** Bounded lowercase URL slug for cache-key-bearing route params. */
export function isBoundedRouteSlug(value: string | undefined): boolean {
  return Boolean(
    value && value.length <= MAX_ROUTE_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
  );
}

export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "dark" ? "dark" : "light";
}
