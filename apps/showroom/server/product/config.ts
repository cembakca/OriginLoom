import { config, numberEnv } from "@originloom/core/config";
import { assertPositiveInteger } from "@originloom/core/config-validation";

/** Product-specific environment: analytics, market stream, menu cache, ops secrets. */
export const productConfig = {
  gtmContainerId: process.env.GTM_CONTAINER_ID?.trim() ?? "",
  clientErrorRateLimit: numberEnv("CLIENT_ERROR_RATE_LIMIT", 120),
  clientErrorWindowMs: numberEnv("CLIENT_ERROR_WINDOW_MS", 60_000),
  clientErrorSampleRate: numberEnv("CLIENT_ERROR_SAMPLE_RATE", 1),
  clientErrorIpRateLimit: numberEnv("CLIENT_ERROR_IP_RATE_LIMIT", 20),
  clientErrorIpMaxEntries: numberEnv("CLIENT_ERROR_IP_MAX_ENTRIES", 10_000),
  clientErrorIpTtlMs: numberEnv("CLIENT_ERROR_IP_TTL_MS", 300_000),
  botAnalyticsQueueCapacity: numberEnv("BOT_ANALYTICS_QUEUE_CAPACITY", 1_000),
  botAnalyticsConcurrency: numberEnv("BOT_ANALYTICS_CONCURRENCY", 2),
  botAnalyticsBatchSize: numberEnv("BOT_ANALYTICS_BATCH_SIZE", 25),
  botAnalyticsFlushMs: numberEnv("BOT_ANALYTICS_FLUSH_MS", 250),
  botAnalyticsDedupTtlMs: numberEnv("BOT_ANALYTICS_DEDUP_TTL_MS", 60_000),
  botAnalyticsSampleRate: numberEnv("BOT_ANALYTICS_SAMPLE_RATE", 1),
  botAnalyticsDrainTimeoutMs: numberEnv("BOT_ANALYTICS_DRAIN_TIMEOUT_MS", 3_000),
  marketStreamToken:
    process.env.MARKET_STREAM_TOKEN ??
    (config.nodeEnv === "production" ? "" : "dev-market-stream-token"),
  marketStreamMaxConnections: numberEnv("MARKET_STREAM_MAX_CONNECTIONS", 1_000),
  marketStreamMaxConnectionsPerIp: numberEnv("MARKET_STREAM_MAX_CONNECTIONS_PER_IP", 5),
  marketStreamMaxSymbols: numberEnv("MARKET_STREAM_MAX_SYMBOLS", 25),
  marketStreamMaxDurationMs: numberEnv("MARKET_STREAM_MAX_DURATION_MS", 300_000),
  marketStreamHeartbeatMs: numberEnv("MARKET_STREAM_HEARTBEAT_MS", 15_000),
  googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined,
  bingSiteVerification: process.env.BING_SITE_VERIFICATION?.trim() || undefined,
  yandexSiteVerification: process.env.YANDEX_SITE_VERIFICATION?.trim() || undefined,
  menuCacheTtl: numberEnv("MENU_CACHE_TTL", 14_400),
  menuCacheSwr: numberEnv("MENU_CACHE_SWR", 86_400),
  cachePurgeSecret: process.env.CACHE_PURGE_SECRET,
  referralStatsSecret: process.env.REFERRAL_STATS_SECRET,
} as const;

export type ProductConfig = typeof productConfig;

/** Read at request time so rotated secrets can be injected without coupling API code to process.env. */
export function purgeSecurityConfig(): { secret?: string; isProduction: boolean } {
  const secret = process.env.CACHE_PURGE_SECRET;
  return {
    ...(secret ? { secret } : {}),
    isProduction: (process.env.NODE_ENV ?? config.nodeEnv) === "production",
  };
}

/** Read at request time so the operations token can rotate without changing handler ownership. */
export function referralStatsSecurityConfig(): { secret?: string; isProduction: boolean } {
  const secret = process.env.REFERRAL_STATS_SECRET;
  return {
    ...(secret ? { secret } : {}),
    isProduction: (process.env.NODE_ENV ?? config.nodeEnv) === "production",
  };
}

/** Pass to `validateConfig([...])` from the composition root. */
export function validateProductConfig(): void {
  assertPositiveInteger("MENU_CACHE_TTL", productConfig.menuCacheTtl);
  if (!Number.isFinite(productConfig.menuCacheSwr) || productConfig.menuCacheSwr < 0) {
    throw new Error(`Invalid MENU_CACHE_SWR: ${productConfig.menuCacheSwr}`);
  }
  assertPositiveInteger("BOT_ANALYTICS_QUEUE_CAPACITY", productConfig.botAnalyticsQueueCapacity);
  assertPositiveInteger("BOT_ANALYTICS_CONCURRENCY", productConfig.botAnalyticsConcurrency);
  assertPositiveInteger("BOT_ANALYTICS_BATCH_SIZE", productConfig.botAnalyticsBatchSize);
  assertPositiveInteger("BOT_ANALYTICS_FLUSH_MS", productConfig.botAnalyticsFlushMs);
  assertPositiveInteger("BOT_ANALYTICS_DEDUP_TTL_MS", productConfig.botAnalyticsDedupTtlMs);
  assertPositiveInteger("BOT_ANALYTICS_DRAIN_TIMEOUT_MS", productConfig.botAnalyticsDrainTimeoutMs);
  if (
    !Number.isFinite(productConfig.botAnalyticsSampleRate) ||
    productConfig.botAnalyticsSampleRate < 0 ||
    productConfig.botAnalyticsSampleRate > 1
  ) {
    throw new Error(`Invalid BOT_ANALYTICS_SAMPLE_RATE: ${productConfig.botAnalyticsSampleRate}`);
  }
  if (productConfig.botAnalyticsConcurrency > productConfig.botAnalyticsQueueCapacity) {
    throw new Error("BOT_ANALYTICS_CONCURRENCY must not exceed BOT_ANALYTICS_QUEUE_CAPACITY");
  }
  if (productConfig.botAnalyticsBatchSize > productConfig.botAnalyticsQueueCapacity) {
    throw new Error("BOT_ANALYTICS_BATCH_SIZE must not exceed BOT_ANALYTICS_QUEUE_CAPACITY");
  }
  if (productConfig.botAnalyticsBatchSize > 100) {
    throw new Error("BOT_ANALYTICS_BATCH_SIZE must not exceed 100");
  }
  if (productConfig.botAnalyticsDrainTimeoutMs >= config.shutdownTimeoutMs) {
    throw new Error("BOT_ANALYTICS_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS");
  }
  assertPositiveInteger("CLIENT_ERROR_RATE_LIMIT", productConfig.clientErrorRateLimit);
  assertPositiveInteger("CLIENT_ERROR_WINDOW_MS", productConfig.clientErrorWindowMs);
  assertPositiveInteger("CLIENT_ERROR_IP_RATE_LIMIT", productConfig.clientErrorIpRateLimit);
  assertPositiveInteger("CLIENT_ERROR_IP_MAX_ENTRIES", productConfig.clientErrorIpMaxEntries);
  assertPositiveInteger("CLIENT_ERROR_IP_TTL_MS", productConfig.clientErrorIpTtlMs);
  if (productConfig.clientErrorIpTtlMs < productConfig.clientErrorWindowMs) {
    throw new Error("CLIENT_ERROR_IP_TTL_MS must be >= CLIENT_ERROR_WINDOW_MS");
  }
  if (
    !Number.isFinite(productConfig.clientErrorSampleRate) ||
    productConfig.clientErrorSampleRate < 0 ||
    productConfig.clientErrorSampleRate > 1
  ) {
    throw new Error(`Invalid CLIENT_ERROR_SAMPLE_RATE: ${productConfig.clientErrorSampleRate}`);
  }
  assertPositiveInteger("MARKET_STREAM_MAX_CONNECTIONS", productConfig.marketStreamMaxConnections);
  assertPositiveInteger(
    "MARKET_STREAM_MAX_CONNECTIONS_PER_IP",
    productConfig.marketStreamMaxConnectionsPerIp,
  );
  assertPositiveInteger("MARKET_STREAM_MAX_SYMBOLS", productConfig.marketStreamMaxSymbols);
  assertPositiveInteger("MARKET_STREAM_MAX_DURATION_MS", productConfig.marketStreamMaxDurationMs);
  assertPositiveInteger("MARKET_STREAM_HEARTBEAT_MS", productConfig.marketStreamHeartbeatMs);
  if (productConfig.marketStreamMaxConnectionsPerIp > productConfig.marketStreamMaxConnections) {
    throw new Error(
      "MARKET_STREAM_MAX_CONNECTIONS_PER_IP must not exceed MARKET_STREAM_MAX_CONNECTIONS",
    );
  }
  if (productConfig.marketStreamMaxSymbols > 100) {
    throw new Error("MARKET_STREAM_MAX_SYMBOLS must not exceed 100");
  }
  if (productConfig.marketStreamHeartbeatMs >= productConfig.marketStreamMaxDurationMs) {
    throw new Error("MARKET_STREAM_HEARTBEAT_MS must be lower than MARKET_STREAM_MAX_DURATION_MS");
  }
  if (productConfig.gtmContainerId && !/^GTM-[A-Z0-9]{4,20}$/.test(productConfig.gtmContainerId)) {
    throw new Error(`Invalid GTM_CONTAINER_ID: ${productConfig.gtmContainerId}`);
  }
  validateVerificationToken("GOOGLE_SITE_VERIFICATION", productConfig.googleSiteVerification);
  validateVerificationToken("BING_SITE_VERIFICATION", productConfig.bingSiteVerification);
  validateVerificationToken("YANDEX_SITE_VERIFICATION", productConfig.yandexSiteVerification);

  if (config.isProduction) {
    if (!productConfig.cachePurgeSecret) {
      throw new Error("CACHE_PURGE_SECRET is required in production");
    }
    if (!productConfig.referralStatsSecret) {
      throw new Error("REFERRAL_STATS_SECRET is required in production");
    }
    if (!productConfig.marketStreamToken) {
      throw new Error("MARKET_STREAM_TOKEN is required in production");
    }
  }
}

function validateVerificationToken(name: string, value: string | undefined): void {
  if (
    value &&
    (value.length > 256 || /[\s"'<>]/.test(value) || [...value].some(isControlCharacter))
  ) {
    throw new Error(`Invalid ${name}`);
  }
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
}
