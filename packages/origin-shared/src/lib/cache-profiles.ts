/**
 * Named cache lifetimes, so a policy says what it means instead of what it counts.
 *
 * `ttl: 14_400` is a number somebody chose once; six months later nobody knows
 * whether it was reasoning or a guess, and the only way to change the whole
 * site's freshness is to find every literal. A profile carries the intent —
 * "menu-shaped content, changes when an editor publishes" — and the numbers live
 * in one table that can be reviewed and tuned as a unit.
 *
 * Raw numbers still work. A route with a genuinely unusual lifetime should say
 * so with a number and a comment rather than bend a profile out of shape; the
 * profiles are for the cases that repeat, which is most of them.
 */
export type CacheProfileName =
  "realtime" | "minutes" | "hours" | "daily" | "static" | "endpoint" | "menu";

export type CacheProfile = {
  /** Seconds the entry is served without asking anyone. */
  ttl: number;
  /** Seconds past the TTL an entry may still be served while it refreshes behind the request. */
  swr: number;
  /** Why this profile exists, shown in the route manifest. */
  description: string;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Every profile carries an SWR window. That is deliberate: without one, the
 * request that finds an expired entry pays for the refill, which is the request
 * least able to afford it — a cold burst arrives exactly when the entry expires.
 */
export const cacheProfiles: Record<CacheProfileName, CacheProfile> = {
  /** Prices, availability, anything a visitor would notice going stale. */
  realtime: { ttl: 30, swr: 5 * MINUTE, description: "Değişimi anında görülmesi gereken veri" },
  /** Listings and search results: stale for a minute is invisible, a miss is not. */
  minutes: { ttl: 5 * MINUTE, swr: HOUR, description: "Listeler, arama sonuçları" },
  /** Editorial pages: changes when someone publishes, not on a clock. */
  hours: { ttl: HOUR, swr: 6 * HOUR, description: "Editoryal sayfalar, ürün detayları" },
  /** Content that turns over once a day at most. */
  daily: { ttl: DAY, swr: DAY, description: "Günde bir değişen içerik" },
  /** Legal text, about pages — changed by a deploy, not by traffic. */
  static: { ttl: 7 * DAY, swr: 7 * DAY, description: "Neredeyse hiç değişmeyen sayfalar" },
  /** Shared endpoint data behind several pages. */
  endpoint: { ttl: 4 * HOUR, swr: DAY, description: "Sayfaların altındaki paylaşılan uç verisi" },
  /** Navigation: the same for everyone on a device, and expensive to lose. */
  menu: { ttl: 4 * HOUR, swr: DAY, description: "Menü ve site navigasyonu" },
};

export function cacheProfile(name: CacheProfileName): CacheProfile {
  return cacheProfiles[name];
}

/**
 * Resolves either spelling into `{ ttl, swr }`.
 *
 * Takes a profile name or an explicit pair, so a caller can accept both without
 * every call site branching. An explicit `swr` alongside a profile overrides
 * just that half — the common case of "this profile, but hold stale longer".
 */
export function resolveCacheLifetime(
  input: CacheProfileName | { ttl: number; swr?: number },
  overrides: { swr?: number } = {},
): { ttl: number; swr: number } {
  const base = typeof input === "string" ? cacheProfiles[input] : { ...input, swr: input.swr ?? 0 };
  return { ttl: base.ttl, swr: overrides.swr ?? base.swr };
}
