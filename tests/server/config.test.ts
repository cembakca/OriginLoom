import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

async function validateWith(env: Record<string, string | undefined>): Promise<void> {
  process.env = { ...originalEnv };
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
        RELEASE_ID: "release-1",
      }),
    ).rejects.toThrow("CACHE_BACKEND=memory is not supported in production");
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
        RELEASE_ID: "release-1",
        VITE_DEV_SERVER_URL: "http://localhost:5174",
      }),
    ).rejects.toThrow("VITE_DEV_SERVER_URL is not allowed in production");
  });
});
