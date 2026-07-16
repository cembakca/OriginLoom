import { parsePage } from "~/lib/content-values";
import {
  type Blog,
  type BlogOrderBy,
  DEFAULT_BLOG_ORDER,
  type PaginatedBlogs,
} from "~/lib/contracts/blogs";

const AUTHORS = ["Ayşe Kaya", "Mehmet Demir", "Zeynep Arslan", "Can Yıldız"];
const TAGS = ["react", "ssr", "web", "performance", "typescript", "cache"];

const ALL_BLOGS: Blog[] = Array.from({ length: 24 }, (_, i) => {
  const n = i + 1;
  return {
    id: `blog-${n}`,
    slug: `blog-yazisi-${n}`,
    title: `SSR Kit ile Modern Web #${n}`,
    excerpt: `Sayfa ${Math.ceil(n / 6)} örneği — explicit cache key ve island mimarisiyle paginated blog listesi.`,
    author: AUTHORS[i % AUTHORS.length] ?? "Unknown",
    publishedAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    readTimeMin: 3 + (i % 5),
    tags: [TAGS[i % TAGS.length] ?? "web", TAGS[(i + 2) % TAGS.length] ?? "ssr"],
  };
});

const DEFAULT_PAGE_SIZE = 6;

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

export function sortBlogs(blogs: readonly Blog[], orderBy: BlogOrderBy): Blog[] {
  const copy = [...blogs];
  switch (orderBy) {
    case "date-asc":
      return copy.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    case "date-desc":
      return copy.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    case "title-asc":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "tr"));
    case "title-desc":
      return copy.sort((a, b) => b.title.localeCompare(a.title, "tr"));
    case "read-time-desc":
      return copy.sort((a, b) => b.readTimeMin - a.readTimeMin);
    default:
      return copy;
  }
}

export async function getPaginatedBlogs(
  page: number,
  options?: { pageSize?: number; orderBy?: BlogOrderBy },
): Promise<PaginatedBlogs> {
  await new Promise((r) => setTimeout(r, 10));

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const orderBy = options?.orderBy ?? DEFAULT_BLOG_ORDER;
  const sorted = sortBlogs(ALL_BLOGS, orderBy);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;

  return {
    posts: sorted.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
    orderBy,
  };
}

export function parsePageParam(raw: string | null): number {
  return parsePage(raw);
}
