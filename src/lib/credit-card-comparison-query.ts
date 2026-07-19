import { isBoundedRouteSlug } from "~/lib/content-values";

export const defaultComparedCreditCards = ["maximum", "bonus", "axess"] as const;

export function parseComparedCreditCards(search: URLSearchParams): string[] | null {
  const raw = search.get("products");
  const slugs = (raw ? raw.split(",") : [...defaultComparedCreditCards]).map((value) =>
    value.trim(),
  );
  if (
    slugs.length < 2 ||
    slugs.length > 3 ||
    slugs.some((slug) => !isBoundedRouteSlug(slug)) ||
    new Set(slugs).size !== slugs.length
  )
    return null;
  return slugs;
}

export function comparisonSearch(slugs: string[]): URLSearchParams {
  return new URLSearchParams({ products: slugs.join(",") });
}
