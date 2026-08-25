import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

async function validateWith(env: Record<string, string | undefined>): Promise<void> {
  process.env = { ...originalEnv };
  if (env.NODE_ENV === "production") {
    delete process.env.VITE_DEV_SERVER_URL;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const { validateConfig } = await import("@originloom/core/config");
  const { validateProductConfig } = await import("@server/product/config");
  validateConfig([validateProductConfig]);
}

describe("server config", () => {
  it("rejects an unknown cache backend", async () => {
    await expect(validateWith({ CACHE_BACKEND: "redsi" })).rejects.toThrow("Invalid CACHE_BACKEND");
  });

  it("rejects an invalid memory cache size", async () => {
    await expect(validateWith({ CACHE_BACKEND: "memory", CACHE_MAX_ENTRIES: "0" })).rejects.toThrow(
      "Invalid CACHE_MAX_ENTRIES",
    );
  });

  it("rejects invalid L1 byte budgets and namespace reserves", async () => {
    await expect(
      validateWith({ CACHE_L1_MAX_BYTES: "1000", CACHE_L1_PAGE_MAX_BYTES: "1001" }),
    ).rejects.toThrow("CACHE_L1_PAGE_MAX_BYTES must not exceed CACHE_L1_MAX_BYTES");
    await expect(
      validateWith({
        CACHE_L1_MAX_BYTES: "1000",
        CACHE_L1_PAGE_RESERVE_BYTES: "600",
        CACHE_L1_DATA_RESERVE_BYTES: "300",
        CACHE_L1_FRAGMENT_RESERVE_BYTES: "200",
        CACHE_L1_NEGATIVE_RESERVE_BYTES: "0",
      }),
    ).rejects.toThrow("CACHE_L1 namespace reserves must not exceed CACHE_L1_MAX_BYTES in total");
  });

  it("rejects a cold-fill polling interval longer than its wait budget", async () => {
    await expect(
      validateWith({
        CACHE_FILL_TIMEOUT_MS: "100",
        CACHE_FILL_WAIT_MS: "100",
        CACHE_FILL_POLL_MS: "101",
      }),
    ).rejects.toThrow("CACHE_FILL_POLL_MS must not exceed CACHE_FILL_WAIT_MS");
  });

  it("rejects a cold-fill wait budget shorter than owner execution budget", async () => {
    await expect(
      validateWith({ CACHE_FILL_TIMEOUT_MS: "1000", CACHE_FILL_WAIT_MS: "999" }),
    ).rejects.toThrow("CACHE_FILL_WAIT_MS must not be lower than CACHE_FILL_TIMEOUT_MS");
  });

  it("keeps the default fragment budget inside the SSR request deadline", async () => {
    await expect(validateWith({ FRAGMENT_TIMEOUT_MS: "0" })).rejects.toThrow(
      "Invalid FRAGMENT_TIMEOUT_MS",
    );
    await expect(
      validateWith({ FRAGMENT_TIMEOUT_MS: "15000", SSR_REQUEST_TIMEOUT_MS: "15000" }),
    ).rejects.toThrow("FRAGMENT_TIMEOUT_MS must be lower than SSR_REQUEST_TIMEOUT_MS");
  });

  it("rejects unsafe bot analytics queue and sampling settings", async () => {
    await expect(validateWith({ BOT_ANALYTICS_SAMPLE_RATE: "1.1" })).rejects.toThrow(
      "Invalid BOT_ANALYTICS_SAMPLE_RATE",
    );
    await expect(
      validateWith({ BOT_ANALYTICS_QUEUE_CAPACITY: "10", BOT_ANALYTICS_BATCH_SIZE: "11" }),
    ).rejects.toThrow("BOT_ANALYTICS_BATCH_SIZE must not exceed BOT_ANALYTICS_QUEUE_CAPACITY");
    await expect(
      validateWith({ SHUTDOWN_TIMEOUT_MS: "6000", BOT_ANALYTICS_DRAIN_TIMEOUT_MS: "6000" }),
    ).rejects.toThrow("BOT_ANALYTICS_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS");
  });

  it("requires explicit production origins and secrets", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: undefined,
        SITE_URL: undefined,
        CACHE_PURGE_SECRET: undefined,
        RELEASE_ID: undefined,
        APP_ID: undefined,
      }),
    ).rejects.toThrow("GATEWAY_URL (Upstream the SSR loaders read from");
  });

  it("allows L1-only production when CACHE_BACKEND=memory", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "memory",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        REFERRAL_STATS_SECRET: "referral-secret",
        MARKET_STREAM_TOKEN: "market-secret",
        AUTH_REFRESH_COORDINATION_SECRET: "a-dedicated-auth-coordination-secret-123",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
      }),
    ).resolves.toBeUndefined();
  });

  it("requires REDIS_URL when CACHE_BACKEND=redis regardless of CACHE_REQUIRED", async () => {
    await expect(
      validateWith({
        CACHE_BACKEND: "redis",
        CACHE_REQUIRED: "false",
        REDIS_URL: undefined,
      }),
    ).rejects.toThrow("REDIS_URL is required when CACHE_BACKEND=redis");
  });

  it("allows memory cache in production only for APP_ENV=loadtest", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        APP_ENV: "loadtest",
        CACHE_BACKEND: "memory",
        GATEWAY_URL: "http://127.0.0.1:4002",
        ALLOW_INSECURE_GATEWAY: "true",
        SITE_URL: "http://127.0.0.1:31005",
        CACHE_PURGE_SECRET: "loadtest-purge-secret",
        REFERRAL_STATS_SECRET: "loadtest-referral-stats-secret",
        MARKET_STREAM_TOKEN: "loadtest-market-stream-token",
        AUTH_REFRESH_COORDINATION_SECRET: "loadtest-auth-coordination-secret",
        RELEASE_ID: "loadtest",
        APP_ID: "showroom",
      }),
    ).resolves.toBeUndefined();
  });

  it("requires a dedicated production token for referral statistics", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        REFERRAL_STATS_SECRET: undefined,
        AUTH_REFRESH_COORDINATION_SECRET: "a-dedicated-auth-coordination-secret-123",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
      }),
    ).rejects.toThrow("REFERRAL_STATS_SECRET is required in production");
  });

  it("requires a server-only production token for the upstream market stream", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        REFERRAL_STATS_SECRET: "referral-secret",
        MARKET_STREAM_TOKEN: undefined,
        AUTH_REFRESH_COORDINATION_SECRET: "a-dedicated-auth-coordination-secret-123",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
      }),
    ).rejects.toThrow("MARKET_STREAM_TOKEN is required in production");
  });

  it("requires a dedicated encryption secret for cross-replica auth refresh coordination", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        REFERRAL_STATS_SECRET: "referral-secret",
        MARKET_STREAM_TOKEN: "market-secret",
        AUTH_REFRESH_COORDINATION_SECRET: "too-short",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
      }),
    ).rejects.toThrow("AUTH_REFRESH_COORDINATION_SECRET must be at least 32 characters");
  });

  it("fails closed when production deployment placeholders were not replaced", async () => {
    const production = {
      NODE_ENV: "production",
      CACHE_BACKEND: "memory",
      GATEWAY_URL: "https://gateway.example.com",
      SITE_URL: "https://www.example.com",
      CACHE_PURGE_SECRET: "a-real-cache-purge-secret",
      REFERRAL_STATS_SECRET: "referral-secret",
      MARKET_STREAM_TOKEN: "market-secret",
      AUTH_REFRESH_COORDINATION_SECRET: "a-real-auth-coordination-secret-123456",
      RELEASE_ID: "release-1",
      APP_ID: "showroom",
    };

    await expect(
      validateWith({
        ...production,
        AUTH_REFRESH_COORDINATION_SECRET: "replace-with-a-dedicated-long-random-secret",
      }),
    ).rejects.toThrow(
      "AUTH_REFRESH_COORDINATION_SECRET still contains a template placeholder in production",
    );
    await expect(
      validateWith({ ...production, CACHE_PURGE_SECRET: "replace-with-a-long-random-secret" }),
    ).rejects.toThrow("CACHE_PURGE_SECRET still contains a template placeholder in production");
    await expect(
      validateWith({ ...production, RELEASE_ID: "replace-with-release-or-git-sha" }),
    ).rejects.toThrow("RELEASE_ID still contains a template placeholder in production");
  });

  it("rejects a weak previous auth coordination key during rotation", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        REFERRAL_STATS_SECRET: "referral-secret",
        MARKET_STREAM_TOKEN: "market-secret",
        AUTH_REFRESH_COORDINATION_SECRET: "a-dedicated-auth-coordination-secret-123",
        AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET: "weak",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
      }),
    ).rejects.toThrow("AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET must be at least 32 characters");
  });

  it("rejects the Vite development runtime in production", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        REFERRAL_STATS_SECRET: "referral-secret",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
        VITE_DEV_SERVER_URL: "http://localhost:5174",
      }),
    ).rejects.toThrow("VITE_DEV_SERVER_URL is not allowed in production");
  });

  it("requires HTTPS for a production image CDN", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
        IMAGE_CDN_URL: "http://images.example.com/transform",
      }),
    ).rejects.toThrow("Production IMAGE_CDN_URL must use https");
  });

  it("validates GTM container IDs before embedding them into an inline script", async () => {
    await expect(validateWith({ GTM_CONTAINER_ID: "GTM-ABC123';alert(1)//" })).rejects.toThrow(
      "Invalid GTM_CONTAINER_ID",
    );
    await expect(validateWith({ GTM_CONTAINER_ID: "GTM-ABC123" })).resolves.toBeUndefined();
  });

  it("requires gateway and asset CDN URL trust boundaries", async () => {
    await expect(
      validateWith({ GATEWAY_URL: "https://user:pass@gateway.example/path" }),
    ).rejects.toThrow("GATEWAY_URL must be an HTTP(S) origin");
    await expect(
      validateWith({ ASSET_CDN_URL: "https://cdn.example/assets?token=secret" }),
    ).rejects.toThrow("ASSET_CDN_URL must be an HTTP(S) URL");
  });

  it("requires HTTPS for a production gateway unless an internal HTTP exception is explicit", async () => {
    const production = {
      NODE_ENV: "production",
      CACHE_BACKEND: "redis",
      REDIS_URL: "redis://localhost:6379",
      GATEWAY_URL: "http://gateway.internal",
      SITE_URL: "https://www.example.com",
      CACHE_PURGE_SECRET: "secret",
      REFERRAL_STATS_SECRET: "referral-secret",
      MARKET_STREAM_TOKEN: "market-secret",
      AUTH_REFRESH_COORDINATION_SECRET: "a-dedicated-auth-coordination-secret-123",
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      RELEASE_ID: "release-1",
      APP_ID: "showroom",
    };
    await expect(validateWith(production)).rejects.toThrow("Production GATEWAY_URL must use https");
    await expect(
      validateWith({ ...production, ALLOW_INSECURE_GATEWAY: "true" }),
    ).resolves.toBeUndefined();
  });

  it("validates metrics and client telemetry limits", async () => {
    await expect(validateWith({ PORT: "3005", METRICS_PORT: "3005" })).rejects.toThrow(
      "Invalid METRICS_PORT",
    );
    await expect(validateWith({ CLIENT_ERROR_SAMPLE_RATE: "-0.1" })).rejects.toThrow(
      "Invalid CLIENT_ERROR_SAMPLE_RATE",
    );
    await expect(validateWith({ CLIENT_ERROR_IP_MAX_ENTRIES: "0" })).rejects.toThrow(
      "Invalid CLIENT_ERROR_IP_MAX_ENTRIES",
    );
    await expect(
      validateWith({
        CLIENT_ERROR_WINDOW_MS: "60000",
        CLIENT_ERROR_IP_TTL_MS: "30000",
      }),
    ).rejects.toThrow("CLIENT_ERROR_IP_TTL_MS must be >= CLIENT_ERROR_WINDOW_MS");
  });

  it("keeps SSR queue and cold-fill budgets inside the request deadline", async () => {
    await expect(
      validateWith({
        CACHE_FILL_TIMEOUT_MS: "12000",
        CACHE_FILL_WAIT_MS: "12500",
        SSR_REQUEST_TIMEOUT_MS: "12000",
      }),
    ).rejects.toThrow("SSR_REQUEST_TIMEOUT_MS must exceed CACHE_FILL_TIMEOUT_MS");
    await expect(
      validateWith({
        CACHE_FILL_TIMEOUT_MS: "500",
        CACHE_FILL_WAIT_MS: "500",
        SSR_REQUEST_TIMEOUT_MS: "1000",
        SSR_QUEUE_WAIT_MS: "1000",
      }),
    ).rejects.toThrow("SSR_QUEUE_WAIT_MS must be lower than SSR_REQUEST_TIMEOUT_MS");
    await expect(validateWith({ SSR_MAX_CONCURRENCY: "0" })).rejects.toThrow(
      "Invalid SSR_MAX_CONCURRENCY",
    );
    await expect(validateWith({ SSR_MAX_CONCURRENCY: "513" })).rejects.toThrow(
      "Invalid SSR_MAX_CONCURRENCY",
    );
  });

  it("requires SITE_URL to be a public origin rather than a path-bearing URL", async () => {
    await expect(
      validateWith({ SITE_URL: "https://www.example.com/base?source=config" }),
    ).rejects.toThrow("SITE_URL must be an HTTP(S) origin");
  });

  it("rejects unsafe webmaster verification tokens", async () => {
    await expect(validateWith({ GOOGLE_SITE_VERIFICATION: 'token"><script>' })).rejects.toThrow(
      "Invalid GOOGLE_SITE_VERIFICATION",
    );
  });

  it("requires HTTPS for a non-loopback production SITE_URL", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "http://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
      }),
    ).rejects.toThrow("Production SITE_URL must use https");
  });

  it("normalizes and permits a bare localhost image CDN for local production containers", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      CACHE_BACKEND: "redis",
      REDIS_URL: "redis://localhost:6379",
      GATEWAY_URL: "https://gateway.example.com",
      SITE_URL: "https://www.example.com",
      CACHE_PURGE_SECRET: "secret",
      REFERRAL_STATS_SECRET: "referral-secret",
      MARKET_STREAM_TOKEN: "market-secret",
      AUTH_REFRESH_COORDINATION_SECRET: "a-dedicated-auth-coordination-secret-123",
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      RELEASE_ID: "release-1",
      APP_ID: "showroom",
      IMAGE_CDN_URL: "localhost:3005/images/",
    };
    delete process.env.VITE_DEV_SERVER_URL;
    vi.resetModules();
    const { config, validateConfig } = await import("@originloom/core/config");

    expect(config.imageCdnUrl).toBe("http://localhost:3005/images");
    expect(config.cspEnforce).toBe(true);
    expect(() => validateConfig()).not.toThrow();
  });

  it("requires HTTPS for a production image transformer", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        RELEASE_ID: "release-1",
        APP_ID: "showroom",
        IMAGE_TRANSFORM_URL: "http://images.example.com/transform",
      }),
    ).rejects.toThrow("Production IMAGE_TRANSFORM_URL must use https");
  });

  it("requires TLS for non-loopback production Redis unless explicitly exempted", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "redis",
        REDIS_URL: "redis://redis.internal:6379",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
      }),
    ).rejects.toThrow("Production REDIS_URL must use rediss");
  });

  it("rejects invalid trusted proxy networks", async () => {
    await expect(validateWith({ TRUSTED_PROXY_CIDRS: "10.0.0.0/99" })).rejects.toThrow(
      "Invalid TRUSTED_PROXY_CIDRS entry",
    );
  });

  it("rejects an unknown log format", async () => {
    await expect(validateWith({ LOG_FORMAT: "table" })).rejects.toThrow("Invalid LOG_FORMAT");
  });
});
