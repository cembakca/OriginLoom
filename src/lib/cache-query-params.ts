import type { Ctx } from "~/lib/types";

/**
 * SSR HTML'i etkilemeyen query parametreleri — cache key'e asla girmez.
 * Middleware bu değerleri cookie'ye yazar; analytics client-side okur.
 */
export const TRACKING_QUERY_PARAM_NAMES = new Set([
  "utm",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref",
  "referrer",
  "resource",
]);

export type ContentQueryConfig = {
  /** Bu route'ta SSR çıktısını değiştiren query param allowlist'i. */
  include: readonly string[];
  /** Param yokken cache key'de kullanılacak sabit değerler. */
  defaults?: Record<string, string>;
};

export function isTrackingQueryParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_QUERY_PARAM_NAMES.has(lower)) return true;
  if (lower.startsWith("utm_")) return true;
  return false;
}

/** Allowlist dışındaki tüm query param'ları döndürür (debug / guard). */
export function foreignQueryParamNames(url: URL, include: readonly string[]): string[] {
  const allowed = new Set(include.map((n) => n.toLowerCase()));
  const foreign: string[] = [];
  for (const name of url.searchParams.keys()) {
    const lower = name.toLowerCase();
    if (allowed.has(lower) || isTrackingQueryParam(lower)) continue;
    foreign.push(name);
  }
  return foreign;
}

/**
 * Cache key parçası — yalnızca içerik değiştiren param'lar, sıralı ve stabil.
 * Örnek: `page=2` veya `amount=75000&page=1`
 */
export function contentQueryCacheFragment(ctx: Ctx, config: ContentQueryConfig): string {
  if (config.include.length === 0) return "-";

  const parts = config.include.map((name) => {
    const value = ctx.url.searchParams.get(name) ?? config.defaults?.[name] ?? "-";
    return `${name}=${value}`;
  });

  return parts.join("&");
}

/** SSR island props için — yalnızca içerik param'larından search string (tracking hariç). */
export function contentSearchString(url: URL, include: readonly string[]): string {
  if (include.length === 0) return "";

  const params = new URLSearchParams();
  for (const name of include) {
    const value = url.searchParams.get(name);
    if (value !== null) params.set(name, value);
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
