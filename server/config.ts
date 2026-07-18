type CacheBackend = "memory" | "redis";

import { validateAppConfig } from "./config-validation";

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
  clientErrorIpRateLimit: numberEnv("CLIENT_ERROR_IP_RATE_LIMIT", 20),
  clientErrorIpMaxEntries: numberEnv("CLIENT_ERROR_IP_MAX_ENTRIES", 10_000),
  clientErrorIpTtlMs: numberEnv("CLIENT_ERROR_IP_TTL_MS", 300_000),
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
  referralStatsSecret: process.env.REFERRAL_STATS_SECRET,
  releaseId: process.env.RELEASE_ID ?? "development",
  assetCdnUrl: process.env.ASSET_CDN_URL?.replace(/\/$/, "") || undefined,
  imageCdnUrl: publicHttpUrlEnv("IMAGE_CDN_URL"),
  imageTransformUrl: publicHttpUrlEnv("IMAGE_TRANSFORM_URL"),
  viteDevServerUrl: process.env.VITE_DEV_SERVER_URL?.replace(/\/$/, "") || undefined,
  gatewayUrl: (process.env.GATEWAY_URL ?? "http://localhost:4002").replace(/\/$/, ""),
  cspEnforce: booleanEnv("CSP_ENFORCE", false),
  cspReportUri: process.env.CSP_REPORT_URI?.trim() || undefined,
} as const;

export type AppConfig = typeof config;

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

export function validateConfig(): void {
  validateAppConfig(config, process.env);
}
