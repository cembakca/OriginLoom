import { describe, expect, it } from "vitest";

import { type AppConfig, config } from "../src/config.js";
import { validateAppConfig } from "../src/config-validation.js";

const productionEnv: NodeJS.ProcessEnv = {
  GATEWAY_URL: "https://gateway.example.com",
  SITE_URL: "https://example.com",
  RELEASE_ID: "release-2026-08-21",
};

function productionConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...config,
    isProduction: true,
    viteDevServerUrl: undefined,
    gatewayUrl: "https://gateway.example.com",
    siteUrl: "https://example.com",
    authRefreshCoordinationSecret: "a".repeat(32),
    authRefreshCoordinationPreviousSecret: undefined,
    releaseId: "release-2026-08-21",
    cachePurgeSecret: undefined,
    ...overrides,
  };
}

// OR5: assertNotProductionPlaceholder is an exact-match sentinel, not a substring
// check — an ordinary release id that happens to contain "todo" must be accepted,
// while CHANGE_ME/REPLACE_ME-style separator variants must be rejected exactly.
describe("production placeholder sentinel (OR5)", () => {
  it("accepts a real production config", () => {
    expect(() => validateAppConfig(productionConfig(), productionEnv)).not.toThrow();
  });

  it.each([
    "TODO",
    "CHANGEME",
    "CHANGE-ME",
    "CHANGE_ME",
    "change_me",
    "REPLACE-ME",
    "REPLACE_ME",
    "replace_me",
    "PLACEHOLDER",
    "replace-with-secret",
  ])("rejects exact placeholder %s as RELEASE_ID", (placeholder) => {
    expect(() =>
      validateAppConfig(productionConfig({ releaseId: placeholder }), {
        ...productionEnv,
        RELEASE_ID: placeholder,
      }),
    ).toThrow(/RELEASE_ID/);
  });

  it.each(["release-todo-2026", "my-todochange-id", "changeme-service-v2", "v1.2.3-release"])(
    "accepts an ordinary release id that merely contains a placeholder-like substring: %s",
    (releaseId) => {
      expect(() =>
        validateAppConfig(productionConfig({ releaseId }), {
          ...productionEnv,
          RELEASE_ID: releaseId,
        }),
      ).not.toThrow();
    },
  );

  it.each(["TODO", "CHANGE_ME", "change_me", "REPLACE_ME", "replace_me", "PLACEHOLDER"])(
    "rejects exact placeholder %s as CACHE_PURGE_SECRET",
    (placeholder) => {
      expect(() =>
        validateAppConfig(productionConfig({ cachePurgeSecret: placeholder }), productionEnv),
      ).toThrow(/CACHE_PURGE_SECRET/);
    },
  );

  it("accepts a real secret that merely contains a placeholder-like substring as CACHE_PURGE_SECRET", () => {
    expect(() =>
      validateAppConfig(
        productionConfig({ cachePurgeSecret: "release-todochange-2026-secret" }),
        productionEnv,
      ),
    ).not.toThrow();
  });
});
