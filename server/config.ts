import { env } from "~/lib/env";

export const config = env;

export function validateConfig(): void {
  if (config.cacheBackend === "redis" && !config.redisUrl) {
    throw new Error("REDIS_URL is required when CACHE_BACKEND=redis");
  }
  if (Number.isNaN(config.port) || config.port <= 0) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }
}
