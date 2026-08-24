import { availableParallelism } from "node:os";

import { validateAppConfig } from "./config-validation.js";

type CacheBackend = "memory" | "redis";

export function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined ? fallback : Number(value);
}

/** Default render slots scale with CPU count; explicit env always wins. */
export function defaultSsrMaxConcurrency(): number {
  return Math.min(256, Math.max(32, availableParallelism() * 4));
}

export function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

/** Reads one of a closed set, falling back rather than booting on a typo's meaning. */
export function enumEnv<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const value = process.env[name]?.trim();
  return value && (values as readonly string[]).includes(value) ? (value as T) : fallback;
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
const cacheL1MaxBytes = numberEnv("CACHE_L1_MAX_BYTES", 128 * 1024 * 1024);

/** Platform runtime configuration. Product-specific env lives in the app config. */
export const config = {
  port: numberEnv("PORT", 3005),
  metricsPort: numberEnv("METRICS_PORT", 9090),
  /**
   * Whether the operations listener runs at all.
   *
   * It carries `/metrics`, readiness and the cache purge endpoints — things a
   * deployment needs and a laptop usually does not. Off in development so
   * `pnpm dev` binds one port instead of two; set `METRICS_ENABLED=true` when
   * you want to look at a metric or purge a key locally.
   */
  metricsEnabled: booleanEnv("METRICS_ENABLED", nodeEnv === "production"),
  cacheBackend: (process.env.CACHE_BACKEND ?? "memory") as CacheBackend,
  cacheRequired: booleanEnv("CACHE_REQUIRED", false),
  redisUrl: process.env.REDIS_URL,
  cacheMaxEntries: numberEnv("CACHE_MAX_ENTRIES", 2000),
  cacheL1MaxBytes,
  cacheL1Namespaces: {
    page: {
      maxBytes: numberEnv("CACHE_L1_PAGE_MAX_BYTES", cacheL1MaxBytes),
      reserveBytes: numberEnv("CACHE_L1_PAGE_RESERVE_BYTES", Math.floor(cacheL1MaxBytes * 0.4)),
    },
    data: {
      maxBytes: numberEnv("CACHE_L1_DATA_MAX_BYTES", Math.floor(cacheL1MaxBytes * 0.6)),
      reserveBytes: numberEnv("CACHE_L1_DATA_RESERVE_BYTES", Math.floor(cacheL1MaxBytes * 0.2)),
    },
    fragment: {
      maxBytes: numberEnv("CACHE_L1_FRAGMENT_MAX_BYTES", Math.floor(cacheL1MaxBytes * 0.3)),
      reserveBytes: numberEnv("CACHE_L1_FRAGMENT_RESERVE_BYTES", Math.floor(cacheL1MaxBytes * 0.1)),
    },
    negative: {
      maxBytes: numberEnv("CACHE_L1_NEGATIVE_MAX_BYTES", Math.floor(cacheL1MaxBytes * 0.1)),
      reserveBytes: numberEnv(
        "CACHE_L1_NEGATIVE_RESERVE_BYTES",
        Math.floor(cacheL1MaxBytes * 0.02),
      ),
    },
  },
  cacheL1Auxiliary: {
    maxLocks: numberEnv("CACHE_L1_MAX_LOCKS", 4_000),
    maxEphemeralValues: numberEnv("CACHE_L1_MAX_EPHEMERAL_VALUES", 2_000),
    maxRateLimits: numberEnv("CACHE_L1_MAX_RATE_LIMITS", 10_000),
  },
  nodeEnv,
  appEnv: process.env.APP_ENV ?? nodeEnv,
  isProduction: nodeEnv === "production",
  shutdownTimeoutMs: numberEnv("SHUTDOWN_TIMEOUT_MS", 10_000),
  /** Ceiling on concurrently running `after()` tasks; past it they are refused, not queued. */
  afterTaskMaxInFlight: numberEnv("AFTER_TASK_MAX_IN_FLIGHT", 1_000),
  afterTaskDrainTimeoutMs: numberEnv("AFTER_TASK_DRAIN_TIMEOUT_MS", 2_000),
  // Off by default: a 103 helps only while the server is waiting on an
  // upstream, and costs a write on every response that was not waiting.
  earlyHints: booleanEnv("EARLY_HINTS", false),
  ssrRequestTimeoutMs,
  apiRequestTimeoutMs: numberEnv("API_REQUEST_TIMEOUT_MS", 12_000),
  proxyRequestTimeoutMs: numberEnv("PROXY_REQUEST_TIMEOUT_MS", 8_000),
  ssrMaxConcurrency: numberEnv("SSR_MAX_CONCURRENCY", defaultSsrMaxConcurrency()),
  ssrMaxQueue: numberEnv("SSR_MAX_QUEUE", 64),
  ssrQueueWaitMs: numberEnv("SSR_QUEUE_WAIT_MS", 250),
  revalidationAttempts: numberEnv("SWR_REVALIDATION_ATTEMPTS", 3),
  revalidationBackoffMs: numberEnv("SWR_REVALIDATION_BACKOFF_MS", 250),
  revalidationDrainTimeoutMs: numberEnv("SWR_DRAIN_TIMEOUT_MS", 5_000),
  gatewayTimeoutMs,
  gatewayConnectTimeoutMs: numberEnv("GATEWAY_CONNECT_TIMEOUT_MS", 1_000),
  gatewayHeadersTimeoutMs: numberEnv("GATEWAY_HEADERS_TIMEOUT_MS", gatewayTimeoutMs),
  gatewayBodyTimeoutMs: numberEnv("GATEWAY_BODY_TIMEOUT_MS", gatewayTimeoutMs),
  gatewayMaxConnections: numberEnv("GATEWAY_MAX_CONNECTIONS", 64),
  gatewayPipelining: numberEnv("GATEWAY_PIPELINING", 1),
  gatewayKeepAliveTimeoutMs: numberEnv("GATEWAY_KEEP_ALIVE_TIMEOUT_MS", 10_000),
  authRefreshCoordinationTtlMs: numberEnv(
    "AUTH_REFRESH_COORDINATION_TTL_MS",
    gatewayTimeoutMs + 1_000,
  ),
  authRefreshCoordinationSecret:
    process.env.AUTH_REFRESH_COORDINATION_SECRET ??
    (nodeEnv === "production" ? "" : "development-auth-refresh-coordination-secret"),
  authRefreshCoordinationPreviousSecret:
    process.env.AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET?.trim() || undefined,
  /** Guards the platform's cache inspect/purge endpoints. */
  cachePurgeSecret: process.env.CACHE_PURGE_SECRET?.trim() || undefined,
  cacheFillTimeoutMs,
  cacheFillWaitMs: numberEnv("CACHE_FILL_WAIT_MS", cacheFillTimeoutMs + 500),
  cacheFillPollMs: numberEnv("CACHE_FILL_POLL_MS", 100),
  fragmentTimeoutMs: numberEnv("FRAGMENT_TIMEOUT_MS", Math.min(2_000, cacheFillTimeoutMs)),
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
  httpCompressionThresholdBytes: numberEnv("HTTP_COMPRESSION_THRESHOLD_BYTES", 1_024),
  requestLogSampleRate: numberEnv("REQUEST_LOG_SAMPLE_RATE", nodeEnv === "production" ? 0.1 : 1),
  logLevel: (process.env.LOG_LEVEL ?? "info").toLowerCase(),
  logFormat: (
    process.env.LOG_FORMAT ?? (nodeEnv === "development" ? "pretty" : "json")
  ).toLowerCase(),
  imageCdnUrl: publicHttpUrlEnv("IMAGE_CDN_URL"),
  imageTransformUrl: publicHttpUrlEnv("IMAGE_TRANSFORM_URL"),
  viteDevServerUrl: process.env.VITE_DEV_SERVER_URL?.replace(/\/$/, "") || undefined,
  /**
   * Client build output directory holding the Vite and media manifests plus static
   * assets. Relative paths resolve against the process cwd, which is the app root in
   * every run mode; tooling that runs from the workspace root sets it explicitly.
   */
  clientDistDir: process.env.CLIENT_DIST_DIR?.replace(/\/$/, "") || "dist/client",
  /**
   * Unprocessed static files served under /public/*. Relative to the app root in every
   * run mode; set PUBLIC_DIR to override.
   */
  publicDir: process.env.PUBLIC_DIR?.replace(/\/$/, "") || "public",
  gatewayUrl: (process.env.GATEWAY_URL ?? "http://localhost:4002").replace(/\/$/, ""),
  /**
   * Shared secret an editor presents to start a draft-preview session. Unset
   * means the feature is off: with no way to tell an editor from anyone else,
   * refusing is the only safe answer.
   */
  previewSecret: process.env.PREVIEW_SECRET?.trim() || undefined,
  /**
   * Signs server-island placeholders. It must be the same across every pod:
   * the placeholder is baked into shared cached HTML by one process and
   * verified by whichever process answers the fill request.
   */
  serverIslandSecret: process.env.SERVER_ISLAND_SECRET?.trim() || undefined,
  previewTtlMs: numberEnv("PREVIEW_TTL_MS", 3_600_000),
  cspEnforce: booleanEnv("CSP_ENFORCE", nodeEnv === "production"),
  /**
   * Trusted Types rollout: `off`, `report` or `enforce`.
   *
   * Defaults to `report` in production — report-only never blocks, so it
   * surfaces the sinks that would break before anything does. Off in
   * development, where the dev server assigns markup the policy has no
   * reason to bless.
   */
  trustedTypes: enumEnv(
    "TRUSTED_TYPES",
    ["off", "report", "enforce"] as const,
    nodeEnv === "production" ? "report" : "off",
  ),
  cspReportUri: process.env.CSP_REPORT_URI?.trim() || undefined,
} as const;

export type AppConfig = typeof config;

/** Validates the platform config, then any product-supplied validators. */
export function validateConfig(extraValidators: Array<() => void> = []): void {
  validateAppConfig(config, process.env);
  for (const validate of extraValidators) validate();
}
