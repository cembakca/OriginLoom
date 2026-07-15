/** Shared runtime env — safe for src/ and server/. */
export const env = {
  port: Number(process.env.PORT ?? 3005),
  cacheBackend: (process.env.CACHE_BACKEND ?? "memory") as "memory" | "redis",
  redisUrl: process.env.REDIS_URL,
  cacheMaxEntries: Number(process.env.CACHE_MAX_ENTRIES ?? 2000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000),
  gtmContainerId: process.env.GTM_CONTAINER_ID ?? "",
  siteUrl: process.env.SITE_URL ?? "http://localhost:3005",
  menuCacheTtl: Number(process.env.MENU_CACHE_TTL ?? 14_400),
  cachePurgeSecret: process.env.CACHE_PURGE_SECRET,
} as const;
