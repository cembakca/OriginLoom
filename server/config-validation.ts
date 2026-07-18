import type { AppConfig } from "./config";

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

export function validateAppConfig(config: AppConfig, env: NodeJS.ProcessEnv): void {
  if (config.cacheBackend !== "memory" && config.cacheBackend !== "redis") {
    throw new Error(`Invalid CACHE_BACKEND: ${env.CACHE_BACKEND}`);
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
  assertPositiveInteger("CLIENT_ERROR_IP_RATE_LIMIT", config.clientErrorIpRateLimit);
  assertPositiveInteger("CLIENT_ERROR_IP_MAX_ENTRIES", config.clientErrorIpMaxEntries);
  assertPositiveInteger("CLIENT_ERROR_IP_TTL_MS", config.clientErrorIpTtlMs);
  if (config.clientErrorIpTtlMs < config.clientErrorWindowMs) {
    throw new Error("CLIENT_ERROR_IP_TTL_MS must be >= CLIENT_ERROR_WINDOW_MS");
  }
  if (
    !Number.isFinite(config.clientErrorSampleRate) ||
    config.clientErrorSampleRate < 0 ||
    config.clientErrorSampleRate > 1
  ) {
    throw new Error(`Invalid CLIENT_ERROR_SAMPLE_RATE: ${config.clientErrorSampleRate}`);
  }
  assertPositiveInteger("MARKET_STREAM_MAX_CONNECTIONS", config.marketStreamMaxConnections);
  assertPositiveInteger(
    "MARKET_STREAM_MAX_CONNECTIONS_PER_IP",
    config.marketStreamMaxConnectionsPerIp,
  );
  assertPositiveInteger("MARKET_STREAM_MAX_SYMBOLS", config.marketStreamMaxSymbols);
  assertPositiveInteger("MARKET_STREAM_MAX_DURATION_MS", config.marketStreamMaxDurationMs);
  assertPositiveInteger("MARKET_STREAM_HEARTBEAT_MS", config.marketStreamHeartbeatMs);
  if (config.marketStreamMaxConnectionsPerIp > config.marketStreamMaxConnections) {
    throw new Error(
      "MARKET_STREAM_MAX_CONNECTIONS_PER_IP must not exceed MARKET_STREAM_MAX_CONNECTIONS",
    );
  }
  if (config.marketStreamMaxSymbols > 100) {
    throw new Error("MARKET_STREAM_MAX_SYMBOLS must not exceed 100");
  }
  if (config.marketStreamHeartbeatMs >= config.marketStreamMaxDurationMs) {
    throw new Error("MARKET_STREAM_HEARTBEAT_MS must be lower than MARKET_STREAM_MAX_DURATION_MS");
  }
  if (config.gtmContainerId && !/^GTM-[A-Z0-9]{4,20}$/.test(config.gtmContainerId)) {
    throw new Error(`Invalid GTM_CONTAINER_ID: ${config.gtmContainerId}`);
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(config.releaseId)) {
    throw new Error(`Invalid RELEASE_ID: ${config.releaseId}`);
  }

  validatePublicUrls(config);

  if (config.isProduction) {
    if (config.viteDevServerUrl)
      throw new Error("VITE_DEV_SERVER_URL is not allowed in production");
    if (config.cacheBackend === "memory") {
      throw new Error("CACHE_BACKEND=memory is not supported in production");
    }
    if (!env.GATEWAY_URL) throw new Error("Production GATEWAY_URL must be explicitly configured");
    if (!env.SITE_URL) throw new Error("Production SITE_URL must be explicitly configured");
    if (!config.cachePurgeSecret) throw new Error("CACHE_PURGE_SECRET is required in production");
    if (!config.referralStatsSecret) {
      throw new Error("REFERRAL_STATS_SECRET is required in production");
    }
    if (!config.marketStreamToken) throw new Error("MARKET_STREAM_TOKEN is required in production");
    if (!env.RELEASE_ID) throw new Error("RELEASE_ID is required in production");
  }
}

function validatePublicUrls(config: AppConfig): void {
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
    assertHttpProtocol("VITE_DEV_SERVER_URL", config.viteDevServerUrl);
  }
  if (config.assetCdnUrl) {
    const assetUrl = assertUrl("ASSET_CDN_URL", config.assetCdnUrl);
    if (
      !["http:", "https:"].includes(assetUrl.protocol) ||
      assetUrl.username ||
      assetUrl.password ||
      assetUrl.search ||
      assetUrl.hash
    ) {
      throw new Error("ASSET_CDN_URL must be an HTTP(S) URL without credentials, query or hash");
    }
    requireProductionHttps("ASSET_CDN_URL", assetUrl, config.isProduction);
  }
  if (config.imageCdnUrl) {
    const imageUrl = assertHttpProtocol("IMAGE_CDN_URL", config.imageCdnUrl);
    requireProductionHttps("IMAGE_CDN_URL", imageUrl, config.isProduction);
  }
  if (config.imageTransformUrl) {
    const transformUrl = assertHttpProtocol("IMAGE_TRANSFORM_URL", config.imageTransformUrl);
    requireProductionHttps("IMAGE_TRANSFORM_URL", transformUrl, config.isProduction);
  }
}

function assertHttpProtocol(name: string, value: string): URL {
  const url = assertUrl(name, value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Invalid ${name} protocol: ${url.protocol}`);
  }
  return url;
}

function requireProductionHttps(name: string, url: URL, production: boolean): void {
  if (production && url.protocol !== "https:" && !isLoopbackUrl(url)) {
    throw new Error(`Production ${name} must use https`);
  }
}
