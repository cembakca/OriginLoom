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
  const { validateConfig } = await import("@server/config");
  validateConfig();
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
      }),
    ).rejects.toThrow("Production GATEWAY_URL");
  });

  it("rejects process-local memory cache in production", async () => {
    await expect(
      validateWith({
        NODE_ENV: "production",
        CACHE_BACKEND: "memory",
        GATEWAY_URL: "https://gateway.example.com",
        SITE_URL: "https://www.example.com",
        CACHE_PURGE_SECRET: "secret",
        REFERRAL_STATS_SECRET: "referral-secret",
        RELEASE_ID: "release-1",
      }),
    ).rejects.toThrow("CACHE_BACKEND=memory is not supported in production");
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
        RELEASE_ID: "release-1",
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
        RELEASE_ID: "release-1",
      }),
    ).rejects.toThrow("MARKET_STREAM_TOKEN is required in production");
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
      RELEASE_ID: "release-1",
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
      RELEASE_ID: "release-1",
      IMAGE_CDN_URL: "localhost:3005/images/",
    };
    delete process.env.VITE_DEV_SERVER_URL;
    vi.resetModules();
    const { config, validateConfig } = await import("@server/config");

    expect(config.imageCdnUrl).toBe("http://localhost:3005/images");
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
        IMAGE_TRANSFORM_URL: "http://images.example.com/transform",
      }),
    ).rejects.toThrow("Production IMAGE_TRANSFORM_URL must use https");
  });
});
