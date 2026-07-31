import {
  gatewayFetchWithIdentity,
  releaseGatewayResponse,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { GatewayContracts } from "@server/services/gateway-contracts";
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

export async function getKnowledgeArticles(search: URLSearchParams, request: Request) {
  const response = await gatewayFetchWithIdentity(request, `/content/articles?${search}`);
  return parseResponse(response, isArticleList);
}

export async function getKnowledgeArticle(slug: string, request: Request) {
  const response = await gatewayFetchWithIdentity(
    request,
    `/content/articles/${encodeURIComponent(slug)}`,
  );
  if (response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  return parseResponse(response, isArticleDetail);
}

export async function getPopularKnowledgeArticles(request: Request) {
  const response = await gatewayFetchWithIdentity(request, "/content/articles/popular");
  return parseResponse(response, isPopularArticleList);
}

async function parseResponse<T>(
  response: Response,
  guard: (value: unknown) => value is T,
): Promise<T> {
  await requireGatewayOk(response, "Knowledge center gateway returned");
  const payload = await readGatewayJson(
    response,
    GatewayContracts.knowledgeCenter,
    INVALID_CONTENT,
  );
  return requireGatewayPayload(GatewayContracts.knowledgeCenter, payload, guard, INVALID_CONTENT);
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
