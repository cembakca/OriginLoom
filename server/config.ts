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
const gatewayTimeoutMs = numberEnv("GATEWAY_TIMEOUT_MS", 5_000);
const cacheFillTimeoutMs = numberEnv("CACHE_FILL_TIMEOUT_MS", gatewayTimeoutMs * 2 + 2_000);
const ssrRequestTimeoutMs = numberEnv("SSR_REQUEST_TIMEOUT_MS", 15_000);

export const config = {
  port: numberEnv("PORT", 3005),
  metricsPort: numberEnv("METRICS_PORT", 9090),
  cacheBackend: (process.env.CACHE_BACKEND ?? "memory") as CacheBackend,
  cacheRequired: booleanEnv("CACHE_REQUIRED", false),
  redisUrl: process.env.REDIS_URL,
  cacheMaxEntries: numberEnv("CACHE_MAX_ENTRIES", 2000),
  nodeEnv,
  appEnv: process.env.APP_ENV ?? nodeEnv,
  isProduction: nodeEnv === "production",
  shutdownTimeoutMs: numberEnv("SHUTDOWN_TIMEOUT_MS", 10_000),
  ssrRequestTimeoutMs,
  apiRequestTimeoutMs: numberEnv("API_REQUEST_TIMEOUT_MS", 12_000),
  proxyRequestTimeoutMs: numberEnv("PROXY_REQUEST_TIMEOUT_MS", 8_000),
  ssrMaxConcurrency: numberEnv("SSR_MAX_CONCURRENCY", 32),
  ssrMaxQueue: numberEnv("SSR_MAX_QUEUE", 64),
  ssrQueueWaitMs: numberEnv("SSR_QUEUE_WAIT_MS", 250),
  revalidationAttempts: numberEnv("SWR_REVALIDATION_ATTEMPTS", 3),
  revalidationBackoffMs: numberEnv("SWR_REVALIDATION_BACKOFF_MS", 250),
  revalidationDrainTimeoutMs: numberEnv("SWR_DRAIN_TIMEOUT_MS", 5_000),
  gatewayTimeoutMs,
  cacheFillTimeoutMs,
  cacheFillWaitMs: numberEnv("CACHE_FILL_WAIT_MS", cacheFillTimeoutMs + 500),
  cacheFillPollMs: numberEnv("CACHE_FILL_POLL_MS", 100),
  botAnalyticsQueueCapacity: numberEnv("BOT_ANALYTICS_QUEUE_CAPACITY", 1_000),
  botAnalyticsConcurrency: numberEnv("BOT_ANALYTICS_CONCURRENCY", 2),
  botAnalyticsBatchSize: numberEnv("BOT_ANALYTICS_BATCH_SIZE", 25),
  botAnalyticsFlushMs: numberEnv("BOT_ANALYTICS_FLUSH_MS", 250),
  botAnalyticsDedupTtlMs: numberEnv("BOT_ANALYTICS_DEDUP_TTL_MS", 60_000),
  botAnalyticsSampleRate: numberEnv("BOT_ANALYTICS_SAMPLE_RATE", 1),
  botAnalyticsDrainTimeoutMs: numberEnv("BOT_ANALYTICS_DRAIN_TIMEOUT_MS", 3_000),
  proxyBodyLimitBytes: numberEnv("PROXY_BODY_LIMIT_BYTES", 1_048_576),
  trustProxy: booleanEnv("TRUST_PROXY", false),
  allowInsecureGateway: booleanEnv("ALLOW_INSECURE_GATEWAY", false),
  gtmContainerId: process.env.GTM_CONTAINER_ID?.trim() ?? "",
  clientErrorRateLimit: numberEnv("CLIENT_ERROR_RATE_LIMIT", 120),
  clientErrorWindowMs: numberEnv("CLIENT_ERROR_WINDOW_MS", 60_000),
  clientErrorSampleRate: numberEnv("CLIENT_ERROR_SAMPLE_RATE", 1),
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
  assertPositiveInteger("METRICS_PORT", config.metricsPort);
  if (config.metricsPort > 65_535 || config.metricsPort === config.port) {
    throw new Error(`Invalid METRICS_PORT: ${config.metricsPort}`);
  }
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
  assertPositiveInteger("CACHE_FILL_TIMEOUT_MS", config.cacheFillTimeoutMs);
  assertPositiveInteger("CACHE_FILL_WAIT_MS", config.cacheFillWaitMs);
  assertPositiveInteger("CACHE_FILL_POLL_MS", config.cacheFillPollMs);
  if (config.cacheFillWaitMs < config.cacheFillTimeoutMs) {
    throw new Error("CACHE_FILL_WAIT_MS must not be lower than CACHE_FILL_TIMEOUT_MS");
  }
  if (config.cacheFillPollMs > config.cacheFillWaitMs) {
    throw new Error("CACHE_FILL_POLL_MS must not exceed CACHE_FILL_WAIT_MS");
  }
  assertPositiveInteger("SSR_REQUEST_TIMEOUT_MS", config.ssrRequestTimeoutMs);
  assertPositiveInteger("API_REQUEST_TIMEOUT_MS", config.apiRequestTimeoutMs);
  assertPositiveInteger("PROXY_REQUEST_TIMEOUT_MS", config.proxyRequestTimeoutMs);
  assertPositiveInteger("SSR_MAX_CONCURRENCY", config.ssrMaxConcurrency);
  assertPositiveInteger("SSR_MAX_QUEUE", config.ssrMaxQueue);
  assertPositiveInteger("SSR_QUEUE_WAIT_MS", config.ssrQueueWaitMs);
  if (config.ssrRequestTimeoutMs <= config.cacheFillTimeoutMs) {
    throw new Error("SSR_REQUEST_TIMEOUT_MS must exceed CACHE_FILL_TIMEOUT_MS");
  }
  if (config.ssrQueueWaitMs >= config.ssrRequestTimeoutMs) {
    throw new Error("SSR_QUEUE_WAIT_MS must be lower than SSR_REQUEST_TIMEOUT_MS");
  }
  assertPositiveInteger("BOT_ANALYTICS_QUEUE_CAPACITY", config.botAnalyticsQueueCapacity);
  assertPositiveInteger("BOT_ANALYTICS_CONCURRENCY", config.botAnalyticsConcurrency);
  assertPositiveInteger("BOT_ANALYTICS_BATCH_SIZE", config.botAnalyticsBatchSize);
  assertPositiveInteger("BOT_ANALYTICS_FLUSH_MS", config.botAnalyticsFlushMs);
  assertPositiveInteger("BOT_ANALYTICS_DEDUP_TTL_MS", config.botAnalyticsDedupTtlMs);
  assertPositiveInteger("BOT_ANALYTICS_DRAIN_TIMEOUT_MS", config.botAnalyticsDrainTimeoutMs);
  if (
    !Number.isFinite(config.botAnalyticsSampleRate) ||
    config.botAnalyticsSampleRate < 0 ||
    config.botAnalyticsSampleRate > 1
  ) {
    throw new Error(`Invalid BOT_ANALYTICS_SAMPLE_RATE: ${config.botAnalyticsSampleRate}`);
  }
  if (config.botAnalyticsConcurrency > config.botAnalyticsQueueCapacity) {
    throw new Error("BOT_ANALYTICS_CONCURRENCY must not exceed BOT_ANALYTICS_QUEUE_CAPACITY");
  }
  if (config.botAnalyticsBatchSize > config.botAnalyticsQueueCapacity) {
    throw new Error("BOT_ANALYTICS_BATCH_SIZE must not exceed BOT_ANALYTICS_QUEUE_CAPACITY");
  }
  if (config.botAnalyticsBatchSize > 100) {
    throw new Error("BOT_ANALYTICS_BATCH_SIZE must not exceed 100");
  }
  if (config.botAnalyticsDrainTimeoutMs >= config.shutdownTimeoutMs) {
    throw new Error("BOT_ANALYTICS_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS");
  }
  assertPositiveInteger("PROXY_BODY_LIMIT_BYTES", config.proxyBodyLimitBytes);
  assertPositiveInteger("REDIRECT_CACHE_TTL_MS", config.redirectCacheTtlMs);
  assertPositiveInteger("REDIRECT_CACHE_MAX_ENTRIES", config.redirectCacheMaxEntries);
  assertPositiveInteger("CLIENT_ERROR_RATE_LIMIT", config.clientErrorRateLimit);
  assertPositiveInteger("CLIENT_ERROR_WINDOW_MS", config.clientErrorWindowMs);
  if (
    !Number.isFinite(config.clientErrorSampleRate) ||
    config.clientErrorSampleRate < 0 ||
    config.clientErrorSampleRate > 1
  ) {
    throw new Error(`Invalid CLIENT_ERROR_SAMPLE_RATE: ${config.clientErrorSampleRate}`);
  }
  if (config.gtmContainerId && !/^GTM-[A-Z0-9]{4,20}$/.test(config.gtmContainerId)) {
    throw new Error(`Invalid GTM_CONTAINER_ID: ${config.gtmContainerId}`);
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(config.releaseId)) {
    throw new Error(`Invalid RELEASE_ID: ${config.releaseId}`);
  }

  const gatewayUrl = assertUrl("GATEWAY_URL", config.gatewayUrl);
  if (
    !["http:", "https:"].includes(gatewayUrl.protocol) ||
    gatewayUrl.username ||
    gatewayUrl.password ||
    (gatewayUrl.pathname !== "" && gatewayUrl.pathname !== "/") ||
    gatewayUrl.search ||
    gatewayUrl.hash
  ) {
    throw new Error(
      "GATEWAY_URL must be an HTTP(S) origin without path, credentials, query or hash",
    );
  }
  if (
    config.isProduction &&
    gatewayUrl.protocol !== "https:" &&
    !isLoopbackUrl(gatewayUrl) &&
    !config.allowInsecureGateway
  ) {
    throw new Error(
      "Production GATEWAY_URL must use https unless ALLOW_INSECURE_GATEWAY is explicitly enabled",
    );
  }
  const siteUrl = assertUrl("SITE_URL", config.siteUrl);
  if (
    !["http:", "https:"].includes(siteUrl.protocol) ||
    siteUrl.username ||
    siteUrl.password ||
    (siteUrl.pathname !== "" && siteUrl.pathname !== "/") ||
    siteUrl.search ||
    siteUrl.hash
  ) {
    throw new Error("SITE_URL must be an HTTP(S) origin without path, credentials, query or hash");
  }
  if (config.isProduction && siteUrl.protocol !== "https:" && !isLoopbackUrl(siteUrl)) {
    throw new Error("Production SITE_URL must use https");
  }
  if (config.viteDevServerUrl) {
    const viteUrl = assertUrl("VITE_DEV_SERVER_URL", config.viteDevServerUrl);
    if (!["http:", "https:"].includes(viteUrl.protocol)) {
      throw new Error(`Invalid VITE_DEV_SERVER_URL protocol: ${viteUrl.protocol}`);
    }
  }
  if (config.assetCdnUrl) {
    const assetCdnUrl = assertUrl("ASSET_CDN_URL", config.assetCdnUrl);
    if (
      !["http:", "https:"].includes(assetCdnUrl.protocol) ||
      assetCdnUrl.username ||
      assetCdnUrl.password ||
      assetCdnUrl.search ||
      assetCdnUrl.hash
    ) {
      throw new Error("ASSET_CDN_URL must be an HTTP(S) URL without credentials, query or hash");
    }
    if (config.isProduction && assetCdnUrl.protocol !== "https:" && !isLoopbackUrl(assetCdnUrl)) {
      throw new Error("Production ASSET_CDN_URL must use https");
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
