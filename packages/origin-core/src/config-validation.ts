import { isIP } from "node:net";

import type { AppConfig } from "./config.js";
import type { EnvSchema } from "./env-schema.js";
import { PLATFORM_ENV } from "./platform-env.js";

export function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${name}: ${value}`);
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}: ${value}`);
}

export function assertUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}

function isLoopbackUrl(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

export function validateAppConfig(config: AppConfig, env: NodeJS.ProcessEnv): void {
  if (config.cacheBackend !== "memory" && config.cacheBackend !== "redis") {
    throw new Error(`Invalid CACHE_BACKEND: ${env.CACHE_BACKEND}`);
  }
  if (config.cacheBackend === "redis" && !config.redisUrl) {
    throw new Error("REDIS_URL is required when CACHE_BACKEND=redis");
  }
  if (config.redisUrl) validateRedisUrl(config);
  assertPositiveInteger("PORT", config.port);
  if (config.port > 65_535) throw new Error(`Invalid PORT: ${config.port}`);
  assertPositiveInteger("METRICS_PORT", config.metricsPort);
  if (config.metricsPort > 65_535 || config.metricsPort === config.port) {
    throw new Error(`Invalid METRICS_PORT: ${config.metricsPort}`);
  }
  assertPositiveInteger("CACHE_MAX_ENTRIES", config.cacheMaxEntries);
  validateL1MemoryConfig(config);
  assertPositiveInteger("SWR_REVALIDATION_ATTEMPTS", config.revalidationAttempts);
  assertPositiveInteger("SWR_REVALIDATION_BACKOFF_MS", config.revalidationBackoffMs);
  assertPositiveInteger("SWR_DRAIN_TIMEOUT_MS", config.revalidationDrainTimeoutMs);
  if (config.revalidationDrainTimeoutMs >= config.shutdownTimeoutMs) {
    throw new Error("SWR_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS");
  }
  assertPositiveInteger("GATEWAY_TIMEOUT_MS", config.gatewayTimeoutMs);
  assertPositiveInteger("GATEWAY_CONNECT_TIMEOUT_MS", config.gatewayConnectTimeoutMs);
  assertPositiveInteger("GATEWAY_HEADERS_TIMEOUT_MS", config.gatewayHeadersTimeoutMs);
  assertPositiveInteger("GATEWAY_BODY_TIMEOUT_MS", config.gatewayBodyTimeoutMs);
  assertPositiveInteger("GATEWAY_MAX_CONNECTIONS", config.gatewayMaxConnections);
  assertPositiveInteger("GATEWAY_PIPELINING", config.gatewayPipelining);
  assertPositiveInteger("GATEWAY_KEEP_ALIVE_TIMEOUT_MS", config.gatewayKeepAliveTimeoutMs);
  if (config.gatewayConnectTimeoutMs > config.gatewayTimeoutMs) {
    throw new Error("GATEWAY_CONNECT_TIMEOUT_MS must not exceed GATEWAY_TIMEOUT_MS");
  }
  validateAuthRefreshBudget(config);
  assertPositiveInteger("CACHE_FILL_TIMEOUT_MS", config.cacheFillTimeoutMs);
  assertPositiveInteger("CACHE_FILL_WAIT_MS", config.cacheFillWaitMs);
  assertPositiveInteger("CACHE_FILL_POLL_MS", config.cacheFillPollMs);
  assertPositiveInteger("FRAGMENT_TIMEOUT_MS", config.fragmentTimeoutMs);
  if (config.cacheFillWaitMs < config.cacheFillTimeoutMs) {
    throw new Error("CACHE_FILL_WAIT_MS must not be lower than CACHE_FILL_TIMEOUT_MS");
  }
  if (config.cacheFillPollMs > config.cacheFillWaitMs) {
    throw new Error("CACHE_FILL_POLL_MS must not exceed CACHE_FILL_WAIT_MS");
  }
  if (config.fragmentTimeoutMs >= config.ssrRequestTimeoutMs) {
    throw new Error("FRAGMENT_TIMEOUT_MS must be lower than SSR_REQUEST_TIMEOUT_MS");
  }
  assertPositiveInteger("SSR_REQUEST_TIMEOUT_MS", config.ssrRequestTimeoutMs);
  assertPositiveInteger("API_REQUEST_TIMEOUT_MS", config.apiRequestTimeoutMs);
  assertPositiveInteger("PROXY_REQUEST_TIMEOUT_MS", config.proxyRequestTimeoutMs);
  assertPositiveInteger("SSR_MAX_CONCURRENCY", config.ssrMaxConcurrency);
  if (config.ssrMaxConcurrency > 512) {
    throw new Error(`Invalid SSR_MAX_CONCURRENCY: ${config.ssrMaxConcurrency}`);
  }
  assertPositiveInteger("SSR_MAX_QUEUE", config.ssrMaxQueue);
  assertPositiveInteger("SSR_QUEUE_WAIT_MS", config.ssrQueueWaitMs);
  if (config.ssrRequestTimeoutMs <= config.cacheFillTimeoutMs) {
    throw new Error("SSR_REQUEST_TIMEOUT_MS must exceed CACHE_FILL_TIMEOUT_MS");
  }
  if (config.ssrQueueWaitMs >= config.ssrRequestTimeoutMs) {
    throw new Error("SSR_QUEUE_WAIT_MS must be lower than SSR_REQUEST_TIMEOUT_MS");
  }
  assertPositiveInteger("PROXY_BODY_LIMIT_BYTES", config.proxyBodyLimitBytes);
  assertPositiveInteger("HTTP_COMPRESSION_THRESHOLD_BYTES", config.httpCompressionThresholdBytes);
  if (config.requestLogSampleRate < 0 || config.requestLogSampleRate > 1) {
    throw new Error(`Invalid REQUEST_LOG_SAMPLE_RATE: ${config.requestLogSampleRate}`);
  }
  if (!["debug", "info", "warn", "error", "silent"].includes(config.logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${config.logLevel}`);
  }
  if (!["json", "pretty"].includes(config.logFormat)) {
    throw new Error(`Invalid LOG_FORMAT: ${env.LOG_FORMAT}`);
  }
  validateTrustedProxyConfig(config);
  assertPositiveInteger("REDIRECT_CACHE_TTL_MS", config.redirectCacheTtlMs);
  assertPositiveInteger("REDIRECT_CACHE_MAX_ENTRIES", config.redirectCacheMaxEntries);
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(config.releaseId)) {
    throw new Error(`Invalid RELEASE_ID: ${config.releaseId}`);
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.appId)) {
    throw new Error(`Invalid APP_ID: ${config.appId}`);
  }
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.assetNamespace) ||
    config.assetNamespace.length > 64
  ) {
    throw new Error(`Invalid ASSET_NAMESPACE: ${config.assetNamespace}`);
  }
  const assetCdnEnabled = env.ASSET_CDN_ENABLED?.trim().toLowerCase();
  if (assetCdnEnabled && !["true", "false", "1", "0"].includes(assetCdnEnabled)) {
    throw new Error(`Invalid ASSET_CDN_ENABLED: ${env.ASSET_CDN_ENABLED}`);
  }
  if (config.assetCdnEnabled && !config.assetCdnUrl) {
    throw new Error("ASSET_CDN_URL is required when ASSET_CDN_ENABLED=true");
  }

  validatePublicUrls(config);

  if (config.isProduction) {
    if (config.viteDevServerUrl)
      throw new Error("VITE_DEV_SERVER_URL is not allowed in production");
    // Driven by the declaration rather than by a run of `if`s: adding a required
    // variable is a row in PLATFORM_ENV, and forgetting the check is no longer
    // one of the ways to add one.
    assertDeclaredEnvPresent(env);
    validateAuthRefreshSecrets(config);
    assertNotProductionPlaceholder("RELEASE_ID", config.releaseId);
    // Required rather than defaulted, and the default is refused by name: every
    // app carrying `origin-loom` would share one coordination namespace, which
    // is the failure this variable exists to prevent — and it would fail
    // silently, in production, only once a second product shipped.
    if (config.appId === "origin-loom") {
      throw new Error("APP_ID is still the platform default in production; give this app its own");
    }
    assertNotProductionPlaceholder("APP_ID", config.appId);
    if (config.cachePurgeSecret) {
      assertNotProductionPlaceholder("CACHE_PURGE_SECRET", config.cachePurgeSecret);
    }
  }
}

function validateL1MemoryConfig(config: AppConfig): void {
  assertPositiveInteger("CACHE_L1_MAX_BYTES", config.cacheL1MaxBytes);
  assertPositiveInteger("CACHE_L1_MAX_LOCKS", config.cacheL1Auxiliary.maxLocks);
  assertPositiveInteger(
    "CACHE_L1_MAX_EPHEMERAL_VALUES",
    config.cacheL1Auxiliary.maxEphemeralValues,
  );
  assertPositiveInteger("CACHE_L1_MAX_RATE_LIMITS", config.cacheL1Auxiliary.maxRateLimits);

  let totalReserve = 0;
  for (const [namespace, budget] of Object.entries(config.cacheL1Namespaces)) {
    const label = namespace.toUpperCase();
    assertPositiveInteger(`CACHE_L1_${label}_MAX_BYTES`, budget.maxBytes);
    assertNonNegativeInteger(`CACHE_L1_${label}_RESERVE_BYTES`, budget.reserveBytes);
    if (budget.maxBytes > config.cacheL1MaxBytes) {
      throw new Error(`CACHE_L1_${label}_MAX_BYTES must not exceed CACHE_L1_MAX_BYTES`);
    }
    if (budget.reserveBytes > budget.maxBytes) {
      throw new Error(`CACHE_L1_${label}_RESERVE_BYTES must not exceed its namespace max`);
    }
    totalReserve += budget.reserveBytes;
  }
  if (totalReserve > config.cacheL1MaxBytes) {
    throw new Error("CACHE_L1 namespace reserves must not exceed CACHE_L1_MAX_BYTES in total");
  }
}

function validateAuthRefreshBudget(config: AppConfig): void {
  assertPositiveInteger("AUTH_REFRESH_COORDINATION_TTL_MS", config.authRefreshCoordinationTtlMs);
  if (config.authRefreshCoordinationTtlMs <= config.gatewayTimeoutMs) {
    throw new Error("AUTH_REFRESH_COORDINATION_TTL_MS must exceed GATEWAY_TIMEOUT_MS");
  }
}

function validateAuthRefreshSecrets(config: AppConfig): void {
  if (config.authRefreshCoordinationSecret.length < 32) {
    throw new Error(
      "AUTH_REFRESH_COORDINATION_SECRET must be at least 32 characters in production",
    );
  }
  assertNotProductionPlaceholder(
    "AUTH_REFRESH_COORDINATION_SECRET",
    config.authRefreshCoordinationSecret,
  );
  if (
    config.authRefreshCoordinationPreviousSecret &&
    config.authRefreshCoordinationPreviousSecret.length < 32
  ) {
    throw new Error(
      "AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET must be at least 32 characters when configured",
    );
  }
  if (config.authRefreshCoordinationPreviousSecret) {
    assertNotProductionPlaceholder(
      "AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET",
      config.authRefreshCoordinationPreviousSecret,
    );
  }
}

/**
 * Deployment templates are intentionally non-runnable until sentinels are replaced.
 * This is an exact-match list, not a substring/prefix check (besides the deliberate
 * "replace-with-" prefix): an ordinary release id or secret that merely contains
 * "todo" as a substring (e.g. a ticket reference) must not be rejected. See OR5 in
 * CACHE_PERFORMANCE_ROADMAP.md for the accept/reject matrix this guards.
 */
/**
 * Every variable the platform declares as required, present in production.
 *
 * The message carries the declaration's own `description`, because the useful
 * thing to read at 3am is not the variable's name — the deploy already told you
 * that — but what stops working without it.
 */
function assertDeclaredEnvPresent(env: NodeJS.ProcessEnv): void {
  const declared: EnvSchema = PLATFORM_ENV;
  const missing = Object.entries(declared)
    .filter(([name, spec]) => spec.required === true && !env[name]?.trim())
    .map(([name, spec]) => `${name} (${spec.description})`);
  if (missing.length === 0) return;
  throw new Error(`Required in production but not set:\n  ${missing.join("\n  ")}`);
}

function assertNotProductionPlaceholder(name: string, value: string): void {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.startsWith("replace-with-") ||
    normalized === "change-me" ||
    normalized === "changeme" ||
    normalized === "change_me" ||
    normalized === "replace-me" ||
    normalized === "replace_me" ||
    normalized === "placeholder" ||
    normalized === "todo"
  ) {
    throw new Error(`${name} still contains a template placeholder in production`);
  }
}

function validateTrustedProxyConfig(config: AppConfig): void {
  assertPositiveInteger("TRUSTED_PROXY_HOPS", config.trustedProxyHops);
  if (config.trustProxy && config.isProduction && config.trustedProxyCidrs.length === 0) {
    throw new Error("TRUSTED_PROXY_CIDRS is required when TRUST_PROXY=true in production");
  }
  for (const cidr of config.trustedProxyCidrs) validateCidr(cidr);
}

function validateCidr(cidr: string): void {
  const [address, prefixValue, extra] = cidr.split("/");
  const family = address ? isIP(address) : 0;
  const prefix = prefixValue === undefined ? (family === 4 ? 32 : 128) : Number(prefixValue);
  const maximum = family === 4 ? 32 : 128;
  if (
    extra !== undefined ||
    family === 0 ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > maximum
  ) {
    throw new Error(`Invalid TRUSTED_PROXY_CIDRS entry: ${cidr}`);
  }
}

function validateRedisUrl(config: AppConfig): void {
  const redisUrl = assertUrl("REDIS_URL", config.redisUrl!);
  if (redisUrl.protocol !== "redis:" && redisUrl.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis: or rediss:");
  }
  if (
    config.isProduction &&
    redisUrl.protocol !== "rediss:" &&
    !isLoopbackUrl(redisUrl) &&
    !config.allowInsecureRedis
  ) {
    throw new Error(
      "Production REDIS_URL must use rediss unless ALLOW_INSECURE_REDIS is explicitly enabled",
    );
  }
}

function validatePublicUrls(config: AppConfig): void {
  const gatewayUrl = assertUrl("GATEWAY_URL", config.gatewayUrl);
  if (
    !["http:", "https:"].includes(gatewayUrl.protocol) ||
    gatewayUrl.username ||
    gatewayUrl.password ||
    (gatewayUrl.pathname !== "" && gatewayUrl.pathname !== "/") ||
    gatewayUrl.search ||
    gatewayUrl.hash
  ) {
    throw new Error(
      "GATEWAY_URL must be an HTTP(S) origin without path, credentials, query or hash",
    );
  }
  if (
    config.isProduction &&
    gatewayUrl.protocol !== "https:" &&
    !isLoopbackUrl(gatewayUrl) &&
    !config.allowInsecureGateway
  ) {
    throw new Error(
      "Production GATEWAY_URL must use https unless ALLOW_INSECURE_GATEWAY is explicitly enabled",
    );
  }

  const siteUrl = assertUrl("SITE_URL", config.siteUrl);
  if (
    !["http:", "https:"].includes(siteUrl.protocol) ||
    siteUrl.username ||
    siteUrl.password ||
    (siteUrl.pathname !== "" && siteUrl.pathname !== "/") ||
    siteUrl.search ||
    siteUrl.hash
  ) {
    throw new Error("SITE_URL must be an HTTP(S) origin without path, credentials, query or hash");
  }
  if (config.isProduction && siteUrl.protocol !== "https:" && !isLoopbackUrl(siteUrl)) {
    throw new Error("Production SITE_URL must use https");
  }

  if (config.viteDevServerUrl) {
    assertHttpProtocol("VITE_DEV_SERVER_URL", config.viteDevServerUrl);
  }
  if (config.assetCdnUrl) {
    const assetUrl = assertUrl("ASSET_CDN_URL", config.assetCdnUrl);
    if (
      !["http:", "https:"].includes(assetUrl.protocol) ||
      assetUrl.username ||
      assetUrl.password ||
      (assetUrl.pathname !== "" && assetUrl.pathname !== "/") ||
      assetUrl.search ||
      assetUrl.hash
    ) {
      throw new Error(
        "ASSET_CDN_URL must be an HTTP(S) origin without path, credentials, query or hash",
      );
    }
    requireProductionHttps("ASSET_CDN_URL", assetUrl, config.isProduction);
  }
  if (config.imageCdnUrl) {
    const imageUrl = assertHttpProtocol("IMAGE_CDN_URL", config.imageCdnUrl);
    requireProductionHttps("IMAGE_CDN_URL", imageUrl, config.isProduction);
  }
  if (config.imageTransformUrl) {
    const transformUrl = assertHttpProtocol("IMAGE_TRANSFORM_URL", config.imageTransformUrl);
    requireProductionHttps("IMAGE_TRANSFORM_URL", transformUrl, config.isProduction);
  }
}

function assertHttpProtocol(name: string, value: string): URL {
  const url = assertUrl(name, value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Invalid ${name} protocol: ${url.protocol}`);
  }
  return url;
}

function requireProductionHttps(name: string, url: URL, production: boolean): void {
  if (production && url.protocol !== "https:" && !isLoopbackUrl(url)) {
    throw new Error(`Production ${name} must use https`);
  }
}
