import { MAX_PAGE } from "./content-values";

export type PaginationItem = { kind: "page"; page: number } | { kind: "ellipsis"; key: string };

/** Builds a bounded pagination window: 1 … current±siblings … last. */
export function buildPaginationItems(
  currentPage: number,
  totalPages: number,
  siblings = 2,
): PaginationItem[] {
  const total = clampInteger(totalPages, 1, MAX_PAGE);
  const current = clampInteger(currentPage, 1, total);
  const radius = clampInteger(siblings, 0, 3);

  const visible = new Set<number>([1, total]);
  for (let page = current - radius; page <= current + radius; page++) {
    if (page >= 1 && page <= total) visible.add(page);
  }

  const pages = [...visible].sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  let previous: number | undefined;

  for (const page of pages) {
    if (previous !== undefined && page - previous > 1) {
      items.push({ kind: "ellipsis", key: `${previous}-${page}` });
    }
    items.push({ kind: "page", page });
    previous = page;
  }

  return items;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
