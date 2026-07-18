import type { Pagination } from "./pagination";

export type ArticleSeo = { title: string; description: string; canonicalPath: string };

export type KnowledgeArticleSummary = {
  id: string;
  slug: string;
  title: string;
  category: string;
  tags: string[];
  excerpt: string;
  author: string;
  publishedAt: string;
  updatedAt: string;
  readTimeMin: number;
  imageUrl: string;
  seo: ArticleSeo;
};

export type KnowledgeArticle = KnowledgeArticleSummary & {
  sections: Array<{ heading: string; body: string }>;
  faq: Array<{ question: string; answer: string }>;
};

export type KnowledgeArticleList = {
  items: KnowledgeArticleSummary[];
  pagination: Pagination;
  query: { category: string; tag: string | null; q: string | null; orderBy: string };
  facets: { categories: Array<{ value: string; count: number }> };
};

export type KnowledgeArticleDetail = {
  article: KnowledgeArticle;
  related: KnowledgeArticleSummary[];
};
