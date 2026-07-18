import { isAuthenticated, neverCache, sharedUnlessBypass } from "~/lib/cache-policy";
import { contentQueryCacheFragment, type ContentQueryConfig } from "~/lib/cache-query-params";
import { parseLoanAmount, parsePage, parseTheme } from "~/lib/content-values";
import { Cookie } from "~/lib/cookies";
import type { DeviceType } from "~/lib/device";
import { deviceCacheFragment } from "~/lib/device";
import { cookie, locale } from "~/lib/request";
import { layoutCacheFragment } from "~/lib/shell-data";
import type { CachePolicy, Ctx } from "~/lib/types";

import { financeQueryNormalizers } from "./finance-query";
import { knowledgeQueryNormalizers } from "./knowledge-query";

export type { CacheKeyApiEntry } from "~/lib/cache/key-codec";
export {
  CACHE_KEY_SEP,
  decodeCacheKeyFromApi,
  displayCacheKey,
  encodeCacheKeyForApi,
  formatCacheKey,
  parseCacheKey,
  toCacheKeyApiEntry,
} from "~/lib/cache/key-codec";

/** HTML sayfa cache kimlikleri — purge API ve dokümantasyonda referans. */
export const PageCacheId = {
  home: "home",
  loanCompare: "loan",
  blogsPaginated: "blogs-paginated",
  blogsPaginatedStreaming: "blogs-paginated-streaming",
  retirementBanking: "retirement-banking",
  remoteCustomerObtain: "remote-customer-obtain",
  recourseRedirect: "recourse-redirect",
  account: "account",
  mediaPipeline: "media-pipeline",
  housingLoans: "housing-loans",
  housingLoanDetail: "housing-loan-detail",
  creditCards: "credit-cards",
  creditCardDetail: "credit-card-detail",
  knowledgeCenter: "knowledge-center",
  knowledgeArticle: "knowledge-article",
} as const;

export type PageCacheId = (typeof PageCacheId)[keyof typeof PageCacheId];

export type PageCacheStrategy = "shared" | "never";

export type PageCacheDefinition = {
  id: PageCacheId;
  description: string;
  path: string;
  strategy: PageCacheStrategy;
  ttl?: number;
  swr?: number;
  /** True only when authenticated SSR output differs from anonymous HTML. */
  bypassAuth?: boolean;
  /** SSR HTML'i değiştiren query param allowlist — utm/gclid vb. asla ekleme. */
  contentQueryParams?: readonly string[];
  contentQueryDefaults?: Record<string, string>;
  contentQueryNormalize?: ContentQueryConfig["normalize"];
  buildKey: (ctx: Ctx) => string[];
};

const DEFAULT_TTL = 300;
const DEFAULT_SWR = 3_600;

function queryPart(entry: PageCacheDefinition, ctx: Ctx): string {
  const config: ContentQueryConfig = { include: entry.contentQueryParams! };
  if (entry.contentQueryDefaults) config.defaults = entry.contentQueryDefaults;
  if (entry.contentQueryNormalize) config.normalize = entry.contentQueryNormalize;
  return contentQueryCacheFragment(ctx, config);
}

/** Tüm sayfa cache tanımları — route'lar buradan türetilir. */
export const pageCacheRegistry: Record<PageCacheId, PageCacheDefinition> = {
  [PageCacheId.home]: {
    id: PageCacheId.home,
    description: "Ana sayfa",
    path: "/",
    strategy: "shared",
    ttl: 3600,
    buildKey: (ctx) => ["home", locale(ctx.request), layoutCacheFragment(ctx)],
  },

  [PageCacheId.loanCompare]: {
    id: PageCacheId.loanCompare,
    description: "İhtiyaç kredisi karşılaştırma",
    path: "/ihtiyac-kredisi/:city?",
    strategy: "shared",
    contentQueryParams: ["amount"],
    contentQueryDefaults: { amount: "50000" },
    contentQueryNormalize: { amount: (raw) => String(parseLoanAmount(raw)) },
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.loanCompare];
      return [
        "loan",
        ctx.params.city ?? "-",
        queryPart(entry, ctx),
        deviceCacheFragment(ctx.request),
        locale(ctx.request),
        parseTheme(cookie(ctx.request, Cookie.theme)),
        layoutCacheFragment(ctx),
      ];
    },
  },

  [PageCacheId.blogsPaginated]: {
    id: PageCacheId.blogsPaginated,
    description: "Blog listesi (sayfalı)",
    path: "/blogs/paginated",
    strategy: "shared",
    contentQueryParams: ["page"],
    contentQueryDefaults: { page: "1" },
    contentQueryNormalize: { page: (raw) => String(parsePage(raw)) },
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.blogsPaginated];
      return [
        "blogs-paginated",
        ctx.publicPath,
        queryPart(entry, ctx),
        locale(ctx.request),
        layoutCacheFragment(ctx),
      ];
    },
  },

  [PageCacheId.blogsPaginatedStreaming]: {
    id: PageCacheId.blogsPaginatedStreaming,
    description: "Blog listesi (akışlı / streaming)",
    path: "/blogs/paginated/streaming",
    strategy: "shared",
    contentQueryParams: ["page"],
    contentQueryDefaults: { page: "1" },
    contentQueryNormalize: { page: (raw) => String(parsePage(raw)) },
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.blogsPaginatedStreaming];
      return [
        "blogs-paginated-streaming",
        ctx.publicPath,
        queryPart(entry, ctx),
        locale(ctx.request),
        layoutCacheFragment(ctx),
      ];
    },
  },

  [PageCacheId.retirementBanking]: {
    id: PageCacheId.retirementBanking,
    description: "Emekli bankacılığı",
    path: "/retirement-banking",
    strategy: "shared",
    bypassAuth: true,
    ttl: 3600,
    buildKey: (ctx) => [
      "retirement-banking",
      ctx.publicPath,
      locale(ctx.request),
      layoutCacheFragment(ctx),
    ],
  },

  [PageCacheId.remoteCustomerObtain]: {
    id: PageCacheId.remoteCustomerObtain,
    description: "Uzaktan müşteri edinimi",
    path: "/remote-customer-obtain",
    strategy: "shared",
    buildKey: (ctx) => ["remote-customer-obtain", ctx.publicPath, layoutCacheFragment(ctx)],
  },

  [PageCacheId.recourseRedirect]: {
    id: PageCacheId.recourseRedirect,
    description: "Başvuru yönlendirme (minimal chrome)",
    path: "/recourse/:page/redirect",
    strategy: "shared",
    buildKey: (ctx) => ["recourse-redirect", ctx.params.page ?? "-", ctx.publicPath],
  },

  [PageCacheId.account]: {
    id: PageCacheId.account,
    description: "Hesabım — kişisel, cache dışı",
    path: "/hesabim",
    strategy: "never",
    buildKey: () => [],
  },
  [PageCacheId.mediaPipeline]: {
    id: PageCacheId.mediaPipeline,
    description: "Image ve font pipeline demosu",
    path: "/medya-pipeline",
    strategy: "shared",
    ttl: 3600,
    buildKey: (ctx) => ["media-pipeline", locale(ctx.request), layoutCacheFragment(ctx)],
  },
  [PageCacheId.housingLoans]: {
    id: PageCacheId.housingLoans,
    description: "Konut kredisi ürün listesi",
    path: "/konut-kredisi",
    strategy: "shared",
    contentQueryParams: ["amount", "term", "city", "bank", "sortBy", "page"],
    contentQueryDefaults: {
      amount: "2000000",
      term: "120",
      city: "istanbul",
      bank: "-",
      sortBy: "recommended",
      page: "1",
    },
    contentQueryNormalize: financeQueryNormalizers,
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.housingLoans];
      return [
        "housing-loans",
        queryPart(entry, ctx),
        locale(ctx.request),
        layoutCacheFragment(ctx),
      ];
    },
  },
  [PageCacheId.housingLoanDetail]: {
    id: PageCacheId.housingLoanDetail,
    description: "Konut kredisi ürün detayı",
    path: "/konut-kredisi/:slug",
    strategy: "shared",
    contentQueryParams: ["amount", "term"],
    contentQueryDefaults: { amount: "2000000", term: "120" },
    contentQueryNormalize: financeQueryNormalizers,
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.housingLoanDetail];
      return [
        "housing-loan-detail",
        ctx.params.slug ?? "-",
        queryPart(entry, ctx),
        locale(ctx.request),
        layoutCacheFragment(ctx),
      ];
    },
  },
  [PageCacheId.creditCards]: {
    id: PageCacheId.creditCards,
    description: "Kredi kartı ürün listesi",
    path: "/kredi-kartlari",
    strategy: "shared",
    contentQueryParams: ["bank", "cardType", "annualFee", "network", "sortBy", "page"],
    contentQueryDefaults: {
      bank: "-",
      cardType: "all",
      annualFee: "all",
      network: "all",
      sortBy: "recommended",
      page: "1",
    },
    contentQueryNormalize: financeQueryNormalizers,
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.creditCards];
      return ["credit-cards", queryPart(entry, ctx), locale(ctx.request), layoutCacheFragment(ctx)];
    },
  },
  [PageCacheId.creditCardDetail]: {
    id: PageCacheId.creditCardDetail,
    description: "Kredi kartı ürün detayı ve kampanyaları",
    path: "/kredi-kartlari/:slug",
    strategy: "shared",
    buildKey: (ctx) => [
      "credit-card-detail",
      ctx.params.slug ?? "-",
      locale(ctx.request),
      layoutCacheFragment(ctx),
    ],
  },
  [PageCacheId.knowledgeCenter]: {
    id: PageCacheId.knowledgeCenter,
    description: "Bilgi Merkezi içerik listesi",
    path: "/bilgi-merkezi",
    strategy: "shared",
    contentQueryParams: ["category", "orderBy", "page"],
    contentQueryDefaults: { category: "all", orderBy: "date-desc", page: "1" },
    contentQueryNormalize: knowledgeQueryNormalizers,
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.knowledgeCenter];
      return [
        "knowledge-center",
        queryPart(entry, ctx),
        locale(ctx.request),
        layoutCacheFragment(ctx),
      ];
    },
  },
  [PageCacheId.knowledgeArticle]: {
    id: PageCacheId.knowledgeArticle,
    description: "Bilgi Merkezi makale detayı",
    path: "/bilgi-merkezi/:slug",
    strategy: "shared",
    buildKey: (ctx) => [
      "knowledge-article",
      ctx.params.slug ?? "-",
      locale(ctx.request),
      layoutCacheFragment(ctx),
    ],
  },
};

/** Route `cache` handler'ı — registry'den policy üretir. */
export function pageCachePolicy(id: PageCacheId, ctx: Ctx): CachePolicy {
  const entry = pageCacheRegistry[id];
  if (entry.strategy === "never") return neverCache();

  return sharedUnlessBypass(ctx, entry.buildKey(ctx), {
    ttl: entry.ttl ?? DEFAULT_TTL,
    swr: entry.swr ?? DEFAULT_SWR,
    ...(entry.bypassAuth ? { bypass: isAuthenticated } : {}),
  });
}

/** Menü API cache — HTML'den bağımsız, cihaz başına tek key. */
export function menuCacheKey(device: DeviceType): string {
  return `menu:${device}`;
}

export const menuCacheRegistry = {
  description: "Gateway menü listesi (Header/Footer)",
  keyPattern: "menu:{Desktop|Tablet|Mobile}",
  ttlEnv: "MENU_CACHE_TTL",
  swrEnv: "MENU_CACHE_SWR",
} as const;

export function listPageCachePrefixes(): Array<{
  id: PageCacheId;
  prefix: string;
  path: string;
  strategy: PageCacheStrategy;
  description: string;
}> {
  return Object.values(pageCacheRegistry).map((entry) => ({
    id: entry.id,
    prefix: entry.id,
    path: entry.path,
    strategy: entry.strategy,
    description: entry.description,
  }));
}

export function isKnownPageCachePrefix(prefix: string): prefix is PageCacheId {
  return Object.values(PageCacheId).includes(prefix as PageCacheId);
}
