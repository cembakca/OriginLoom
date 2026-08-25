import { describe, expect, it } from "vitest";

import { type AppConfig, config } from "../src/config.js";
import { validateAppConfig } from "../src/config-validation.js";

const productionEnv: NodeJS.ProcessEnv = {
  GATEWAY_URL: "https://gateway.example.com",
  SITE_URL: "https://example.com",
  RELEASE_ID: "release-2026-08-21",
  APP_ID: "sigorta",
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
    appId: "sigorta",
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

/**
 * `RELEASE_ID` was answering two questions and only one of them well. It changes
 * on every deploy — right for cached HTML, wrong for state two releases have to
 * agree on — and it was separating *products* only by accident, because each app
 * happened to pick its own value. `APP_ID` is the half that was implicit.
 */
describe("APP_ID", () => {
  it("is required in production", () => {
    expect(() =>
      validateAppConfig(productionConfig({ appId: "sigorta" }), {
        ...productionEnv,
        APP_ID: undefined,
      }),
    ).toThrow(/APP_ID is required in production/);
  });

  /**
   * The dangerous value is not a missing one, it is the default: every app
   * carrying it would share a coordination namespace, silently, until a second
   * product shipped.
   */
  it("refuses the platform default in production", () => {
    expect(() =>
      validateAppConfig(productionConfig({ appId: "origin-loom" }), {
        ...productionEnv,
        APP_ID: "origin-loom",
      }),
    ).toThrow(/still the platform default/);
  });

  it("refuses a template placeholder", () => {
    expect(() =>
      validateAppConfig(productionConfig({ appId: "replace-me" }), {
        ...productionEnv,
        APP_ID: "replace-me",
      }),
    ).toThrow(/APP_ID/);
  });

  it("refuses a value that cannot be a key namespace", () => {
    expect(() =>
      validateAppConfig(productionConfig({ appId: "sigorta:prod" }), {
        ...productionEnv,
        APP_ID: "sigorta:prod",
      }),
    ).toThrow(/Invalid APP_ID/);
  });

  /** Outside production the default stands: a laptop has no second product. */
  it("is not required in development", () => {
    expect(() =>
      validateAppConfig({ ...productionConfig({ appId: "origin-loom" }), isProduction: false }, {}),
    ).not.toThrow();
  });
});
