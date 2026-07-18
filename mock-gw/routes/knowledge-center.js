import { knowledgeArticles } from "../data/knowledge-center.js";
import {
  enumParam,
  matchesQuery,
  normalizedQuery,
  paginate,
  parsePage,
  parsePageSize,
} from "../lib/query.js";

const categories = new Set(["all", "konut-kredisi", "kredi-kartlari", "krediler", "yatirim"]);
const sortOrders = new Set(["date-desc", "date-asc", "read-time-asc"]);

export function resolveKnowledgeCenterRequest(request, url) {
  if (request.method === "GET" && url.pathname === "/content/articles") {
    return { status: 200, body: articleList(url.searchParams) };
  }
  if (request.method !== "GET" || !url.pathname.startsWith("/content/articles/")) return null;

  const slug = url.pathname.slice("/content/articles/".length).replaceAll("/", "");
  const article = knowledgeArticles.find((item) => item.slug === slug);
  if (!article) return { status: 404, body: { error: "article not found" } };
  const related = knowledgeArticles
    .filter((item) => item.id !== article.id && item.category === article.category)
    .slice(0, 3)
    .map(articleSummary);
  return { status: 200, body: { article, related } };
}

function articleList(searchParams) {
  const category = enumParam(searchParams, "category", categories, "all");
  const orderBy = enumParam(searchParams, "orderBy", sortOrders, "date-desc");
  const query = normalizedQuery(searchParams.get("q"));
  const tag = normalizedQuery(searchParams.get("tag"));
  const articles = knowledgeArticles
    .filter((item) => category === "all" || item.category === category)
    .filter((item) => !tag || item.tags.some((value) => value.toLocaleLowerCase("tr-TR") === tag))
    .filter((item) => matchesQuery(query, item.title, item.excerpt, ...item.tags));
  sortArticles(articles, orderBy);
  return {
    ...paginate(
      articles.map(articleSummary),
      parsePage(searchParams),
      parsePageSize(searchParams, 6),
    ),
    query: { category, tag: tag || null, q: query || null, orderBy },
    facets: {
      categories: [...categories]
        .filter((item) => item !== "all")
        .map((value) => ({
          value,
          count: knowledgeArticles.filter((article) => article.category === value).length,
        })),
    },
  };
}

function articleSummary(article) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    category: article.category,
    tags: article.tags,
    excerpt: article.excerpt,
    author: article.author,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    readTimeMin: article.readTimeMin,
    imageUrl: article.imageUrl,
    seo: article.seo,
  };
}

function sortArticles(articles, orderBy) {
  if (orderBy === "date-asc") articles.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  else if (orderBy === "read-time-asc") articles.sort((a, b) => a.readTimeMin - b.readTimeMin);
  else articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
