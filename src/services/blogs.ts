export type Blog = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  publishedAt: string;
  readTimeMin: number;
  tags: string[];
};

export type PaginatedBlogs = {
  posts: Blog[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

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

export async function getPaginatedBlogs(
  page: number,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PaginatedBlogs> {
  await new Promise((r) => setTimeout(r, 10));

  const total = ALL_BLOGS.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;

  return {
    posts: ALL_BLOGS.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export function parsePageParam(raw: string | null): number {
  const parsed = Number(raw ?? 1);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}
