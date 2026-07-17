import { gatewayFetch } from "@server/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@server/gateway-payload";

import { MAX_PAGE, parsePage } from "~/lib/content-values";
import {
  type Blog,
  type BlogOrderBy,
  DEFAULT_BLOG_ORDER,
  type PaginatedBlogs,
} from "~/lib/contracts/blogs";

const MAX_PAGE_SIZE = 100;
const MAX_TOTAL_ITEMS = 1_000_000;
const MAX_TEXT_LENGTH = 4_000;
const INVALID_BLOGS = "Blogs gateway returned an invalid payload";

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
  options?: { pageSize?: number; orderBy?: BlogOrderBy; signal?: AbortSignal },
): Promise<PaginatedBlogs> {
  const boundedPage = parsePage(String(page));
  const requestedPageSize = options?.pageSize ?? 6;
  const boundedPageSize = Number.isFinite(requestedPageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedPageSize)))
    : 6;
  const search = new URLSearchParams({
    page: String(boundedPage),
    pageSize: String(boundedPageSize),
    orderBy: options?.orderBy ?? DEFAULT_BLOG_ORDER,
  });
  const response = await gatewayFetch(`/blogs?${search}`, {
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new Error(`Blogs gateway returned ${response.status}`);

  const payload = await readGatewayJson(response, "blogs", INVALID_BLOGS);
  const data = requireGatewayPayload("blogs", payload, isPaginatedBlogs, INVALID_BLOGS);
  if (boundedPage <= data.totalPages && data.page !== boundedPage) {
    throw new Error("Blogs gateway returned a mismatched page");
  }
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
    value.posts.length <= MAX_PAGE_SIZE &&
    value.posts.every(isBlog) &&
    isIntegerInRange(value.page, 1, MAX_PAGE) &&
    isIntegerInRange(value.pageSize, 1, MAX_PAGE_SIZE) &&
    value.posts.length <= value.pageSize &&
    isIntegerInRange(value.total, 0, MAX_TOTAL_ITEMS) &&
    isIntegerInRange(value.totalPages, 0, MAX_PAGE) &&
    typeof value.orderBy === "string" &&
    (VALID_ORDER as string[]).includes(value.orderBy)
  );
}

function isBlog(value: unknown): value is Blog {
  if (!value || typeof value !== "object") return false;
  const blog = value as Record<string, unknown>;
  return (
    isBoundedString(blog.id, 256) &&
    isBoundedString(blog.slug, 256) &&
    isBoundedString(blog.title, 500) &&
    isBoundedString(blog.excerpt, MAX_TEXT_LENGTH) &&
    isBoundedString(blog.author, 256) &&
    isBoundedString(blog.publishedAt, 128) &&
    isIntegerInRange(blog.readTimeMin, 0, 10_000) &&
    Array.isArray(blog.tags) &&
    blog.tags.length <= 20 &&
    blog.tags.every((tag) => isBoundedString(tag, 100))
  );
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
