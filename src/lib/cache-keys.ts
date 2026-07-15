import { neverCache, sharedUnlessBypass } from "~/lib/cache-policy";
import { contentQueryCacheFragment, type ContentQueryConfig } from "~/lib/cache-query-params";
import { Cookie } from "~/lib/cookies";
import type { DeviceType } from "~/lib/device";
import { deviceCacheFragment } from "~/lib/device";
import { cookie, locale } from "~/lib/request";
import { layoutCacheFragment } from "~/lib/shell-data";
import type { CachePolicy, Ctx } from "~/lib/types";

/** HTML sayfa cache kimlikleri — purge API ve dokümantasyonda referans. */
export const PageCacheId = {
  home: "home",
  loanCompare: "loan",
  blogsPaginated: "blogs-paginated",
  retirementBanking: "retirement-banking",
  remoteCustomerObtain: "remote-customer-obtain",
  recourseRedirect: "recourse-redirect",
  account: "account",
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
  buildKey: (ctx: Ctx) => string[];
};

const DEFAULT_TTL = 300;
const DEFAULT_SWR = 86_400;

function queryPart(entry: PageCacheDefinition, ctx: Ctx): string {
  const config: ContentQueryConfig = { include: entry.contentQueryParams! };
  if (entry.contentQueryDefaults) config.defaults = entry.contentQueryDefaults;
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
    buildKey: (ctx) => {
      const entry = pageCacheRegistry[PageCacheId.loanCompare];
      return [
        "loan",
        ctx.params.city ?? "-",
        queryPart(entry, ctx),
        deviceCacheFragment(ctx.request),
        locale(ctx.request),
        cookie(ctx.request, Cookie.theme) ?? "light",
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

  [PageCacheId.retirementBanking]: {
    id: PageCacheId.retirementBanking,
    description: "Emekli bankacılığı",
    path: "/retirement-banking",
    strategy: "shared",
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

export const CACHE_KEY_SEP = "\0";

export function formatCacheKey(parts: string[]): string {
  return parts.join(CACHE_KEY_SEP);
}

export function parseCacheKey(key: string): string[] {
  return key.split(CACHE_KEY_SEP);
}

/** Purge API / operasyon için okunabilir gösterim (kopyalanabilir). */
export function displayCacheKey(key: string): string {
  return parseCacheKey(key).join("::");
}

/** Null ayırıcı içeren key'leri güvenli taşımak için base64url. */
export function encodeCacheKeyForApi(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeCacheKeyFromApi(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

export type CacheKeyApiEntry = {
  /** Store'daki ham mantıksal key (`\0` ayırıcılı). */
  key: string;
  /** Purge body'de `keysEncoded` olarak kullan — kopyala-yapıştır güvenli. */
  encoded: string;
  /** Key parçaları (route registry ile aynı sıra). */
  parts: string[];
  /** İnsan okunur gösterim; silme için değil, debug için. */
  display: string;
};

export function toCacheKeyApiEntry(key: string): CacheKeyApiEntry {
  return {
    key,
    encoded: encodeCacheKeyForApi(key),
    parts: parseCacheKey(key),
    display: displayCacheKey(key),
  };
}

export function isKnownPageCachePrefix(prefix: string): prefix is PageCacheId {
  return Object.values(PageCacheId).includes(prefix as PageCacheId);
}
