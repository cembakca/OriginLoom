import { parsePage } from "./content-values";

const CATEGORIES = new Set(["all", "konut-kredisi", "kredi-kartlari", "krediler", "yatirim"]);
const ORDER = new Set(["date-desc", "date-asc", "read-time-asc"]);

const enumValue = (raw: string | null, allowed: Set<string>, fallback: string) =>
  raw && allowed.has(raw) ? raw : fallback;

export const knowledgeQueryNormalizers: Record<string, (raw: string | null) => string> = {
  category: (raw) => enumValue(raw, CATEGORIES, "all"),
  orderBy: (raw) => enumValue(raw, ORDER, "date-desc"),
  page: (raw) => String(parsePage(raw)),
};

export function knowledgeSearch(url: URL): URLSearchParams {
  const search = new URLSearchParams({
    category: knowledgeQueryNormalizers.category!(url.searchParams.get("category")),
    orderBy: knowledgeQueryNormalizers.orderBy!(url.searchParams.get("orderBy")),
    page: knowledgeQueryNormalizers.page!(url.searchParams.get("page")),
  });
  for (const name of ["q", "tag"] as const) {
    const value = url.searchParams.get(name)?.trim().slice(0, 120);
    if (value) search.set(name, value);
  }
  return search;
}
