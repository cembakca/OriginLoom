import type { CachePolicy, Ctx, RouteCacheResolver } from "@originloom/react/lib/types";
import {
  describeRouteCache,
  neverCache,
  sharedUnlessBypass,
} from "@originloom/shared/lib/cache-policy";
import {
  contentQueryCacheFragment,
  type ContentQueryConfig,
} from "@originloom/shared/lib/cache-query-params";
import type { DeviceType } from "@originloom/shared/lib/device";
import { locale } from "@originloom/shared/lib/request";

import { layoutCacheFragment } from "~/lib/shell-data";

import { financeQueryNormalizers } from "./finance-query";
import { knowledgeQueryNormalizers } from "./knowledge-query";
import { marketQueryNormalizers } from "./market-query";

export type { CacheKeyApiEntry } from "@originloom/core/cache/key-codec";
export {
  CACHE_KEY_SEP,
  decodeCacheKeyFromApi,
  displayCacheKey,
  encodeCacheKeyForApi,
  formatCacheKey,
  parseCacheKey,
  toCacheKeyApiEntry,
} from "@originloom/core/cache/key-codec";

/** HTML sayfa cache kimlikleri — purge API ve dokümantasyonda referans. */
export const PageCacheId = {
  home: "home",
  remoteCustomerObtain: "remote-customer-obtain",
  recourseRedirect: "recourse-redirect",
  account: "account",
  mediaPipeline: "media-pipeline",
  housingLoans: "housing-loans",
  housingLoanDetail: "housing-loan-detail",
  creditCards: "credit-cards",
  bankDetail: "bank-detail",
  knowledgeCenter: "knowledge-center",
  knowledgeArticle: "knowledge-article",
  bist100: "bist100",
  financeReferral: "finance-referral",
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
    path: "/housing-loans",
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
    path: "/housing-loans/:slug",
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
  [PageCacheId.bankDetail]: {
    id: PageCacheId.bankDetail,
    description: "Banka ürün profili",
    path: "/bankalar/:slug",
    strategy: "shared",
    ttl: 900,
    buildKey: (ctx) => [
      "bank-detail",
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
  [PageCacheId.bist100]: {
    id: PageCacheId.bist100,
    description: "BIST 100 hisse listesi",
    path: "/piyasalar/bist-100",
    strategy: "shared",
    ttl: 30,
    swr: 300,
    contentQueryParams: ["sortBy", "page"],
    contentQueryDefaults: { sortBy: "market-cap-desc", page: "1" },
    contentQueryNormalize: marketQueryNormalizers,
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.bist100];
      return ["bist100", queryPart(entry, ctx), locale(ctx.request), layoutCacheFragment(ctx)];
    },
  },
  [PageCacheId.financeReferral]: {
    id: PageCacheId.financeReferral,
    description: "Finans ürünü başvuru yönlendirme onayı",
    path: "/basvuru/:productType/:slug/yonlendirme",
    strategy: "shared",
    buildKey: (ctx) => [
      "finance-referral",
      ctx.params.productType ?? "-",
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
  });
}

/** Runtime cache resolver carrying the same registry metadata used by build output. */
export function pageCache(
  id: PageCacheId,
  resolver: (ctx: Ctx) => CachePolicy = (ctx) => pageCachePolicy(id, ctx),
): RouteCacheResolver {
  const entry = pageCacheRegistry[id];
  if (entry.strategy === "never") {
    return describeRouteCache(resolver, { mode: "none", label: entry.description });
  }
  return describeRouteCache(resolver, {
    mode: "conditional",
    ttl: entry.ttl ?? DEFAULT_TTL,
    swr: entry.swr ?? DEFAULT_SWR,
    ...(entry.contentQueryParams?.length ? { vary: entry.contentQueryParams } : {}),
    label: entry.description,
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
