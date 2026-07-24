type CacheBackend = "memory" | "redis";

import { validateAppConfig } from "./config-validation.js";

export function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined ? fallback : Number(value);
}

export function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function publicHttpUrlEnv(name: string): string | undefined {
  const value = process.env[name]?.trim().replace(/\/$/, "");
  if (!value) return undefined;
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(value)) return `http://${value}`;
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const gatewayTimeoutMs = numberEnv("GATEWAY_TIMEOUT_MS", 5_000);
const cacheFillTimeoutMs = numberEnv("CACHE_FILL_TIMEOUT_MS", gatewayTimeoutMs * 2 + 2_000);
const ssrRequestTimeoutMs = numberEnv("SSR_REQUEST_TIMEOUT_MS", 15_000);

/** Platform runtime configuration. Product-specific env lives in the app config. */
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
  authRefreshCoordinationTtlMs: numberEnv(
    "AUTH_REFRESH_COORDINATION_TTL_MS",
    gatewayTimeoutMs + 1_000,
  ),
  authRefreshCoordinationSecret:
    process.env.AUTH_REFRESH_COORDINATION_SECRET ??
    (nodeEnv === "production" ? "" : "development-auth-refresh-coordination-secret"),
  authRefreshCoordinationPreviousSecret:
    process.env.AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET?.trim() || undefined,
  cacheFillTimeoutMs,
  cacheFillWaitMs: numberEnv("CACHE_FILL_WAIT_MS", cacheFillTimeoutMs + 500),
  cacheFillPollMs: numberEnv("CACHE_FILL_POLL_MS", 100),
  proxyBodyLimitBytes: numberEnv("PROXY_BODY_LIMIT_BYTES", 1_048_576),
  trustProxy: booleanEnv("TRUST_PROXY", false),
  trustedProxyHops: numberEnv("TRUSTED_PROXY_HOPS", 1),
  trustedProxyCidrs: (process.env.TRUSTED_PROXY_CIDRS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  allowInsecureGateway: booleanEnv("ALLOW_INSECURE_GATEWAY", false),
  allowInsecureRedis: booleanEnv("ALLOW_INSECURE_REDIS", false),
  siteUrl: (process.env.SITE_URL ?? "http://localhost:3005").replace(/\/$/, ""),
  redirectCacheTtlMs: numberEnv("REDIRECT_CACHE_TTL_MS", 60_000),
  redirectCacheMaxEntries: numberEnv("REDIRECT_CACHE_MAX_ENTRIES", 10_000),
  redirectAllowedHosts: (process.env.REDIRECT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  releaseId: process.env.RELEASE_ID ?? "development",
  assetCdnUrl: process.env.ASSET_CDN_URL?.replace(/\/$/, "") || undefined,
  imageCdnUrl: publicHttpUrlEnv("IMAGE_CDN_URL"),
  imageTransformUrl: publicHttpUrlEnv("IMAGE_TRANSFORM_URL"),
  viteDevServerUrl: process.env.VITE_DEV_SERVER_URL?.replace(/\/$/, "") || undefined,
  /**
   * Client build output directory holding the Vite and media manifests plus static
   * assets. Relative paths resolve against the process cwd, which is the app root in
   * every run mode; tooling that runs from the workspace root sets it explicitly.
   */
  clientDistDir: process.env.CLIENT_DIST_DIR?.replace(/\/$/, "") || "dist/client",
  gatewayUrl: (process.env.GATEWAY_URL ?? "http://localhost:4002").replace(/\/$/, ""),
  cspEnforce: booleanEnv("CSP_ENFORCE", nodeEnv === "production"),
  cspReportUri: process.env.CSP_REPORT_URI?.trim() || undefined,
} as const;

export type AppConfig = typeof config;

/** Validates the platform config, then any product-supplied validators. */
export function validateConfig(extraValidators: Array<() => void> = []): void {
  validateAppConfig(config, process.env);
  for (const validate of extraValidators) validate();
}
