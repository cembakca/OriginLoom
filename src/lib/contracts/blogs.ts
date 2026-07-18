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

export type BlogOrderBy = "date-desc" | "date-asc" | "title-asc" | "title-desc" | "read-time-desc";

export const BLOG_ORDER_OPTIONS: Array<{ value: BlogOrderBy; label: string }> = [
  { value: "date-desc", label: "En yeni" },
  { value: "date-asc", label: "En eski" },
  { value: "title-asc", label: "Başlık (A-Z)" },
  { value: "title-desc", label: "Başlık (Z-A)" },
  { value: "read-time-desc", label: "Okuma süresi" },
];

export const DEFAULT_BLOG_ORDER: BlogOrderBy = "date-desc";

export type PaginatedBlogs = {
  seoInfo: SeoInfo;
  posts: Blog[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  orderBy: BlogOrderBy;
};
import type { SeoInfo } from "~/lib/metadata/types";
