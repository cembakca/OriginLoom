import { parsePage } from "@originloom/shared/lib/content-values";

const SORT = new Set(["symbol-asc", "price-desc", "change-desc", "change-asc", "market-cap-desc"]);

export const marketQueryNormalizers: Record<string, (raw: string | null) => string> = {
  sortBy: (raw) => (raw && SORT.has(raw) ? raw : "market-cap-desc"),
  page: (raw) => String(parsePage(raw)),
};

export function marketSearch(url: URL): URLSearchParams {
  const search = new URLSearchParams({
    sortBy: marketQueryNormalizers.sortBy!(url.searchParams.get("sortBy")),
    page: marketQueryNormalizers.page!(url.searchParams.get("page")),
  });
  for (const name of ["q", "sector"] as const) {
    const value = url.searchParams.get(name)?.trim().slice(0, 120);
    if (value) search.set(name, value);
  }
  return search;
}
