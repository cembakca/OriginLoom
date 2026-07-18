export const CACHE_KEY_SEP = "\0";

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

export function formatCacheKey(parts: string[]): string {
  return parts.map(escapePart).join(CACHE_KEY_SEP);
}

export function parseCacheKey(key: string): string[] {
  return key.split(CACHE_KEY_SEP).map(unescapePart);
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

export function toCacheKeyApiEntry(key: string): CacheKeyApiEntry {
  return {
    key,
    encoded: encodeCacheKeyForApi(key),
    parts: parseCacheKey(key),
    display: displayCacheKey(key),
  };
}

function escapePart(part: string): string {
  return part.replaceAll("%", "%25").replaceAll(CACHE_KEY_SEP, "%00");
}

function unescapePart(part: string): string {
  return part.replaceAll("%00", CACHE_KEY_SEP).replaceAll("%25", "%");
}
