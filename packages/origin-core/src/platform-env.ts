import type { EnvSchema } from "./env-schema.js";

/**
 * The platform's own environment, declared once.
 *
 * `env-schema.ts` has described how to do this since 0.7.31 and nothing used
 * it — the schema was a well-tested primitive with no callers, which is a
 * different thing from a capability. This is where it starts paying: the
 * production requirements below used to be a run of hand-written `if`s in
 * `config-validation.ts`, and adding a variable meant remembering to write
 * another one. Now it is a row.
 *
 * `access` is the half no `if` was ever expressing. Nothing infers it — a URL
 * is not automatically public and a token is not automatically secret — and
 * `origin-build` refuses to ship a client bundle containing the value of
 * anything marked `secret`.
 *
 * This does not replace `config.ts`. That file parses far more variables than
 * these, most of them tuning knobs with defaults where a wrong value is a
 * performance question rather than a boot-or-leak one. What belongs here is
 * what has a *boundary*: required in production, or never allowed near the
 * browser.
 */
export const PLATFORM_ENV = {
  GATEWAY_URL: {
    description: "Upstream the SSR loaders read from. Without it the app has no data source.",
    access: "public",
    type: "url",
    required: true,
  },
  SITE_URL: {
    description: "This app's own public origin. Canonical URLs and absolute links are built on it.",
    access: "public",
    type: "url",
    required: true,
  },
  RELEASE_ID: {
    description:
      "Build identity; changes on every deploy and namespaces cached HTML so a new release " +
      "never serves the previous one's markup.",
    access: "public",
    type: "string",
    required: true,
  },
  APP_ID: {
    description:
      "Product identity; never changes and namespaces coordination state (idempotency, auth " +
      "refresh, rate limits) so two products on one Redis stay apart.",
    access: "public",
    type: "string",
    required: true,
  },
  AUTH_REFRESH_COORDINATION_SECRET: {
    description: "Encrypts the refresh result pods hand each other. A leak is a session takeover.",
    access: "secret",
    type: "string",
    // Not `required` here even though it is: `validateAuthRefreshSecrets` already
    // demands it in production *and* checks its strength, which is the stronger
    // check. Declaring it twice would mean two rules for one variable that could
    // disagree — and the one that fires first would decide which message the
    // deploy sees.
  },
  AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET: {
    description: "The secret being rotated out; accepted for decryption during the rollout.",
    access: "secret",
    type: "string",
  },
  CACHE_PURGE_SECRET: {
    description: "Guards cache inspect and purge on the operations port.",
    access: "secret",
    type: "string",
  },
  PREVIEW_SECRET: {
    description: "Signs draft-preview grants. A leak lets anyone read unpublished content.",
    access: "secret",
    type: "string",
  },
  SERVER_ISLAND_SECRET: {
    description: "Signs deferred island props, which are attacker-controlled without it.",
    access: "secret",
    type: "string",
  },
  REDIS_URL: {
    description: "Shared cache and coordination store. Usually carries credentials.",
    access: "secret",
    type: "string",
  },
} as const satisfies EnvSchema;

export type PlatformEnv = typeof PLATFORM_ENV;
