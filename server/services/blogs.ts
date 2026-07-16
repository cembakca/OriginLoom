import { gatewayFetch } from "@server/adapters/gateway";

import { parsePage } from "~/lib/content-values";
import { type BlogOrderBy, DEFAULT_BLOG_ORDER, type PaginatedBlogs } from "~/lib/contracts/blogs";

const VALID_ORDER: BlogOrderBy[] = [
  "date-desc",
  "date-asc",
  "title-asc",
  "title-desc",
  "read-time-desc",
];

export function parseOrderByParam(raw: string | null): BlogOrderBy {
  if (raw && (VALID_ORDER as string[]).includes(raw)) return raw as BlogOrderBy;
  return DEFAULT_BLOG_ORDER;
}

export async function getPaginatedBlogs(
  page: number,
  options?: { pageSize?: number; orderBy?: BlogOrderBy },
): Promise<PaginatedBlogs> {
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(options?.pageSize ?? 6),
    orderBy: options?.orderBy ?? DEFAULT_BLOG_ORDER,
  });
  const response = await gatewayFetch(`/blogs?${search}`);
  if (!response.ok) throw new Error(`Blogs gateway returned ${response.status}`);

  const data: unknown = await response.json();
  if (!isPaginatedBlogs(data)) throw new Error("Blogs gateway returned an invalid payload");
  return data;
}

export function parsePageParam(raw: string | null): number {
  return parsePage(raw);
}

function isPaginatedBlogs(data: unknown): data is PaginatedBlogs {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return (
    Array.isArray(value.posts) &&
    typeof value.page === "number" &&
    typeof value.pageSize === "number" &&
    typeof value.total === "number" &&
    typeof value.totalPages === "number" &&
    typeof value.orderBy === "string" &&
    (VALID_ORDER as string[]).includes(value.orderBy)
  );
}
