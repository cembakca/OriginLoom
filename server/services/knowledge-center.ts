import { gatewayFetch } from "@server/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@server/gateway-payload";
import {
  isInteger,
  isIsoDate,
  isOptionalString,
  isPagination,
  isRecord,
  isString,
  isStringArray,
  MAX_COLLECTION,
} from "@server/services/gateway-guards";
import { isSeoInfo } from "@server/services/seo-info";

import type {
  KnowledgeArticle,
  KnowledgeArticleDetail,
  KnowledgeArticleList,
  KnowledgeArticleSummary,
} from "~/lib/contracts/knowledge-center";

const INVALID_CONTENT = "Knowledge center gateway returned an invalid payload";

export async function getKnowledgeArticles(search: URLSearchParams, signal: AbortSignal) {
  const response = await gatewayFetch(`/content/articles?${search}`, { signal });
  return parseResponse(response, isArticleList);
}

export async function getKnowledgeArticle(slug: string, signal: AbortSignal) {
  const response = await gatewayFetch(`/content/articles/${encodeURIComponent(slug)}`, { signal });
  if (response.status === 404) return null;
  return parseResponse(response, isArticleDetail);
}

export async function getPopularKnowledgeArticles(signal: AbortSignal) {
  const response = await gatewayFetch("/content/articles/popular", { signal });
  return parseResponse(response, isPopularArticleList);
}

async function parseResponse<T>(
  response: Response,
  guard: (value: unknown) => value is T,
): Promise<T> {
  if (!response.ok) throw new Error(`Knowledge center gateway returned ${response.status}`);
  const payload = await readGatewayJson(response, "knowledge_center", INVALID_CONTENT);
  return requireGatewayPayload("knowledge_center", payload, guard, INVALID_CONTENT);
}

function isArticleSummary(value: unknown): value is KnowledgeArticleSummary {
  if (!isRecord(value) || !isRecord(value.seo)) return false;
  return (
    isString(value.id, 120) &&
    isString(value.slug, 160) &&
    isString(value.title, 500) &&
    isString(value.category, 100) &&
    isStringArray(value.tags, 30, 100) &&
    isString(value.excerpt, 4_000) &&
    isString(value.author, 160) &&
    isIsoDate(value.publishedAt) &&
    isIsoDate(value.updatedAt) &&
    isInteger(value.readTimeMin, 1, 1_000) &&
    isString(value.imageUrl, 500) &&
    isString(value.seo.title, 500) &&
    isString(value.seo.description, 4_000) &&
    isString(value.seo.canonicalPath, 500)
  );
}

function isArticle(value: unknown): value is KnowledgeArticle {
  if (!isArticleSummary(value)) return false;
  const article = value as KnowledgeArticleSummary & Record<string, unknown>;
  return (
    Array.isArray(article.sections) &&
    article.sections.length <= 100 &&
    article.sections.every(
      (section) =>
        isRecord(section) && isString(section.heading, 500) && isString(section.body, 20_000),
    ) &&
    Array.isArray(article.faq) &&
    article.faq.length <= 50 &&
    article.faq.every(
      (item) => isRecord(item) && isString(item.question, 500) && isString(item.answer, 8_000),
    )
  );
}

function isArticleList(value: unknown): value is KnowledgeArticleList {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_COLLECTION &&
    value.items.every(isArticleSummary) &&
    isPagination(value.pagination) &&
    isRecord(value.query) &&
    isString(value.query.category, 100) &&
    isOptionalString(value.query.tag, 120) &&
    isOptionalString(value.query.q, 120) &&
    isString(value.query.orderBy, 80) &&
    isRecord(value.facets) &&
    Array.isArray(value.facets.categories) &&
    value.facets.categories.length <= 50 &&
    value.facets.categories.every(
      (item) => isRecord(item) && isString(item.value, 100) && isInteger(item.count, 0, 1_000_000),
    )
  );
}

function isArticleDetail(value: unknown): value is KnowledgeArticleDetail {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    isArticle(value.article) &&
    Array.isArray(value.related) &&
    value.related.length <= 20 &&
    value.related.every(isArticleSummary)
  );
}

function isPopularArticleList(value: unknown): value is { items: KnowledgeArticleSummary[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.length <= 6 &&
    value.items.every(isArticleSummary)
  );
}
