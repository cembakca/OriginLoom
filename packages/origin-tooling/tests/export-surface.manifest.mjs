/**
 * Frozen public import surface for `origin-create-app` (template contract).
 *
 * Update this file whenever templates.mjs starts importing a new @originloom/*
 * subpath. CI fails if the template drifted without updating the manifest.
 *
 * Human-readable tables: docs/export-surface.md
 */

/** @type {readonly string[]} */
export const CORE_TEMPLATE_SUBPATHS = [
  "adapters/gateway",
  "api/cache-purge",
  "api/client-errors",
  "api/client-metrics",
  "app",
  "assets",
  "auth/bff",
  "cache",
  "cache/key-codec",
  "cache/resource",
  "config",
  "config-validation",
  "gateway-payload",
  "gateway-transport",
  "handler",
  "instrumentation",
  "logger",
  "media",
  "metrics-server",
  "metrics/primitives",
  "middleware",
  "middleware/cookie-jar",
  "middleware/request-deadline",
  "middleware/request-id",
  "middleware/sanitize",
  "middleware/security",
  "observability",
  "runtime",
  "security/public-api-guard",
  "seo",
];

/** @type {readonly string[]} */
export const REACT_TEMPLATE_SUBPATHS = [
  "lib/client/island-mount",
  "lib/island",
  "lib/link",
  "lib/metadata/metadata-head",
  "lib/query/provider",
  "lib/request-context",
  "lib/types",
  "server",
  "vite",
];

/** @type {readonly string[]} */
export const SHARED_TEMPLATE_SUBPATHS = [
  "head-scripts",
  "lib/analytics/bootstrap",
  "lib/analytics/config",
  "lib/analytics/page-view",
  "lib/analytics/types",
  "lib/cache-policy",
  "lib/cache-query-params",
  "lib/client/api-fetch",
  "lib/client/error-telemetry",
  "lib/client/island-runtime",
  "lib/client/performance-telemetry",
  "lib/client/reload-button",
  "lib/content-url",
  "lib/content-values",
  "lib/cookies",
  "lib/device",
  "lib/media",
  "lib/menu/types",
  "lib/metadata/generate",
  "lib/metadata/jsonld",
  "lib/metadata/merge",
  "lib/metadata/resolve",
  "lib/metadata/schema",
  "lib/metadata/site-config",
  "lib/metadata/types",
  "lib/request",
  "lib/runtime-schema",
  "lib/strip-undefined",
  "lib/types",
  "routing",
  "routing/resolve",
  "routing/types",
  "routing/validate",
];

/** Blocked @originloom/core subpaths (must stay closed). From package.json exports: null */
/** @type {readonly string[]} */
export const CORE_BLOCKED_SUBPATHS = [
  "app/*",
  "cache/cold-fill",
  "cache/l1-policy",
  "cache/revalidation",
  "cache/resource-codec",
  "cache/resource-l1",
  "document/*",
  "metrics/cache-label",
  "metrics/runtime",
  "middleware/context",
  "middleware/pipeline",
  "middleware/product",
  "middleware/static-assets",
  "middleware/steps/auth/refresh-result",
  "middleware/steps/redirection/gone",
  "public-url",
  "shell-resolution",
  "ssr/*",
];
