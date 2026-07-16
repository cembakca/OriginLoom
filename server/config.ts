type CacheBackend = "memory" | "redis";

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined ? fallback : Number(value);
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function publicHttpUrlEnv(name: string): string | undefined {
  const value = process.env[name]?.trim().replace(/\/$/, "");
  if (!value) return undefined;
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(value)) return `http://${value}`;
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  port: numberEnv("PORT", 3005),
  cacheBackend: (process.env.CACHE_BACKEND ?? "memory") as CacheBackend,
  cacheRequired: booleanEnv("CACHE_REQUIRED", false),
  redisUrl: process.env.REDIS_URL,
  cacheMaxEntries: numberEnv("CACHE_MAX_ENTRIES", 2000),
  nodeEnv,
  isProduction: nodeEnv === "production",
  shutdownTimeoutMs: numberEnv("SHUTDOWN_TIMEOUT_MS", 10_000),
  revalidationAttempts: numberEnv("SWR_REVALIDATION_ATTEMPTS", 3),
  revalidationBackoffMs: numberEnv("SWR_REVALIDATION_BACKOFF_MS", 250),
  revalidationDrainTimeoutMs: numberEnv("SWR_DRAIN_TIMEOUT_MS", 5_000),
  gatewayTimeoutMs: numberEnv("GATEWAY_TIMEOUT_MS", 5_000),
  proxyBodyLimitBytes: numberEnv("PROXY_BODY_LIMIT_BYTES", 1_048_576),
  trustProxy: booleanEnv("TRUST_PROXY", false),
  gtmContainerId: process.env.GTM_CONTAINER_ID ?? "",
  siteUrl: (process.env.SITE_URL ?? "http://localhost:3005").replace(/\/$/, ""),
  menuCacheTtl: numberEnv("MENU_CACHE_TTL", 14_400),
  menuCacheSwr: numberEnv("MENU_CACHE_SWR", 86_400),
  redirectCacheTtlMs: numberEnv("REDIRECT_CACHE_TTL_MS", 60_000),
  redirectCacheMaxEntries: numberEnv("REDIRECT_CACHE_MAX_ENTRIES", 10_000),
  redirectAllowedHosts: (process.env.REDIRECT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  cachePurgeSecret: process.env.CACHE_PURGE_SECRET,
  releaseId: process.env.RELEASE_ID ?? "development",
  assetCdnUrl: process.env.ASSET_CDN_URL?.replace(/\/$/, "") || undefined,
  imageCdnUrl: publicHttpUrlEnv("IMAGE_CDN_URL"),
  imageTransformUrl: publicHttpUrlEnv("IMAGE_TRANSFORM_URL"),
  viteDevServerUrl: process.env.VITE_DEV_SERVER_URL?.replace(/\/$/, "") || undefined,
  gatewayUrl: (process.env.GATEWAY_URL ?? "http://localhost:4002").replace(/\/$/, ""),
} as const;

/** Read at request time so rotated secrets can be injected without coupling API code to process.env. */
export function purgeSecurityConfig(): { secret?: string; isProduction: boolean } {
  const secret = process.env.CACHE_PURGE_SECRET;
  return {
    ...(secret ? { secret } : {}),
    isProduction: (process.env.NODE_ENV ?? config.nodeEnv) === "production",
  };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${name}: ${value}`);
}

function assertUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}

function isLoopbackUrl(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

export function validateConfig(): void {
  if (config.cacheBackend !== "memory" && config.cacheBackend !== "redis") {
    throw new Error(`Invalid CACHE_BACKEND: ${process.env.CACHE_BACKEND}`);
  }
  if (config.cacheBackend === "redis" && !config.redisUrl) {
    throw new Error("REDIS_URL is required when CACHE_BACKEND=redis");
  }
  assertPositiveInteger("PORT", config.port);
  if (config.port > 65_535) throw new Error(`Invalid PORT: ${config.port}`);
  assertPositiveInteger("CACHE_MAX_ENTRIES", config.cacheMaxEntries);
  assertPositiveInteger("SWR_REVALIDATION_ATTEMPTS", config.revalidationAttempts);
  assertPositiveInteger("SWR_REVALIDATION_BACKOFF_MS", config.revalidationBackoffMs);
  assertPositiveInteger("SWR_DRAIN_TIMEOUT_MS", config.revalidationDrainTimeoutMs);
  if (config.revalidationDrainTimeoutMs >= config.shutdownTimeoutMs) {
    throw new Error("SWR_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS");
  }
  assertPositiveInteger("MENU_CACHE_TTL", config.menuCacheTtl);
  if (!Number.isFinite(config.menuCacheSwr) || config.menuCacheSwr < 0) {
    throw new Error(`Invalid MENU_CACHE_SWR: ${config.menuCacheSwr}`);
  }
  assertPositiveInteger("GATEWAY_TIMEOUT_MS", config.gatewayTimeoutMs);
  assertPositiveInteger("PROXY_BODY_LIMIT_BYTES", config.proxyBodyLimitBytes);
  assertPositiveInteger("REDIRECT_CACHE_TTL_MS", config.redirectCacheTtlMs);
  assertPositiveInteger("REDIRECT_CACHE_MAX_ENTRIES", config.redirectCacheMaxEntries);
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(config.releaseId)) {
    throw new Error(`Invalid RELEASE_ID: ${config.releaseId}`);
  }

  assertUrl("GATEWAY_URL", config.gatewayUrl);
  assertUrl("SITE_URL", config.siteUrl);
  if (config.viteDevServerUrl) {
    const viteUrl = assertUrl("VITE_DEV_SERVER_URL", config.viteDevServerUrl);
    if (!["http:", "https:"].includes(viteUrl.protocol)) {
      throw new Error(`Invalid VITE_DEV_SERVER_URL protocol: ${viteUrl.protocol}`);
    }
  }
  if (config.imageCdnUrl) {
    const imageCdnUrl = assertUrl("IMAGE_CDN_URL", config.imageCdnUrl);
    if (!["http:", "https:"].includes(imageCdnUrl.protocol)) {
      throw new Error(`Invalid IMAGE_CDN_URL protocol: ${imageCdnUrl.protocol}`);
    }
    if (config.isProduction && imageCdnUrl.protocol !== "https:" && !isLoopbackUrl(imageCdnUrl)) {
      throw new Error("Production IMAGE_CDN_URL must use https");
    }
  }
  if (config.imageTransformUrl) {
    const imageTransformUrl = assertUrl("IMAGE_TRANSFORM_URL", config.imageTransformUrl);
    if (!["http:", "https:"].includes(imageTransformUrl.protocol)) {
      throw new Error(`Invalid IMAGE_TRANSFORM_URL protocol: ${imageTransformUrl.protocol}`);
    }
    if (
      config.isProduction &&
      imageTransformUrl.protocol !== "https:" &&
      !isLoopbackUrl(imageTransformUrl)
    ) {
      throw new Error("Production IMAGE_TRANSFORM_URL must use https");
    }
  }
  if (config.isProduction) {
    if (config.viteDevServerUrl) {
      throw new Error("VITE_DEV_SERVER_URL is not allowed in production");
    }
    if (config.cacheBackend === "memory") {
      throw new Error("CACHE_BACKEND=memory is not supported in production");
    }
    if (!process.env.GATEWAY_URL) {
      throw new Error("Production GATEWAY_URL must be explicitly configured");
    }
    if (!process.env.SITE_URL) {
      throw new Error("Production SITE_URL must be explicitly configured");
    }
    if (!config.cachePurgeSecret) throw new Error("CACHE_PURGE_SECRET is required in production");
    if (!process.env.RELEASE_ID) throw new Error("RELEASE_ID is required in production");
  }
}
