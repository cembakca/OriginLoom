import { isSafeRequestId } from "../middleware/request-id.js";

const CSP_NONCE_PLACEHOLDER = "__ORIGINLOOM_CSP_NONCE__";
const PAGE_REQUEST_ID_PLACEHOLDER = "__ORIGINLOOM_DYNAMIC_PAGE_REQUEST_ID__";
const UNKNOWN_DYNAMIC_PLACEHOLDER = /__ORIGINLOOM_DYNAMIC_[A-Z0-9_]+__/g;
const SAFE_CSP_NONCE = /^[A-Za-z0-9+/_=-]{1,256}$/;

export type DynamicHtmlValues = {
  cspNonce?: string | undefined;
  pageRequestId?: string | undefined;
};

type CachedDynamicHtmlValues = {
  cspNonce?: string;
  pageRequestId?: string;
};

/**
 * Values given to a renderer whose output is intended for the shared HTML cache.
 * The registry is deliberately closed: every slot owns its validation and output
 * context, so adding a new request value requires an explicit security review.
 */
export function cachedHtmlDynamicValues(values: DynamicHtmlValues): CachedDynamicHtmlValues {
  return {
    ...(values.cspNonce !== undefined ? { cspNonce: CSP_NONCE_PLACEHOLDER } : {}),
    ...(values.pageRequestId !== undefined ? { pageRequestId: PAGE_REQUEST_ID_PLACEHOLDER } : {}),
  };
}

/**
 * Converts concrete request values left by a renderer into cache-safe markers.
 * Rendering with `cachedHtmlDynamicValues` is preferred; normalization remains a
 * defence in depth for values copied through loader data or product renderers.
 */
export function normalizeCachedHtmlDynamicValues(body: string, values: DynamicHtmlValues): string {
  let normalized = body;
  if (values.cspNonce) {
    normalized = normalized.replaceAll(
      `nonce="${values.cspNonce}"`,
      `nonce="${CSP_NONCE_PLACEHOLDER}"`,
    );
  }
  if (values.pageRequestId) {
    normalized = normalized.replaceAll(values.pageRequestId, PAGE_REQUEST_ID_PLACEHOLDER);
  }
  return normalized;
}

/** Materializes cache markers with values validated for the current response. */
export function materializeCachedHtmlDynamicValues(
  body: string,
  values: DynamicHtmlValues,
): string {
  let materialized = body;

  if (materialized.includes(CSP_NONCE_PLACEHOLDER)) {
    const nonce = safeCspNonce(values.cspNonce) ? values.cspNonce : undefined;
    materialized = nonce
      ? materialized.replaceAll(`nonce="${CSP_NONCE_PLACEHOLDER}"`, `nonce="${nonce}"`)
      : materialized.replaceAll(` nonce="${CSP_NONCE_PLACEHOLDER}"`, "");
    // A malformed marker outside the reviewed nonce attribute context is never
    // exposed to the browser as an internal implementation token.
    materialized = materialized.replaceAll(CSP_NONCE_PLACEHOLDER, "");
  }

  if (materialized.includes(PAGE_REQUEST_ID_PLACEHOLDER)) {
    const pageRequestId =
      values.pageRequestId && isSafeRequestId(values.pageRequestId) ? values.pageRequestId : "";
    materialized = materialized.replaceAll(PAGE_REQUEST_ID_PLACEHOLDER, pageRequestId);
  }

  // Unknown or damaged future slot markers fail closed instead of reaching the
  // client or being interpreted as real correlation values.
  return materialized.replace(UNKNOWN_DYNAMIC_PLACEHOLDER, "");
}

/** Concrete per-request values identify HTML written by an unsafe older release. */
export function hasUnsafeConcreteCachedHtmlValues(body: string): boolean {
  if (hasUnsafeConcreteCachedNonce(body)) return true;
  return [...body.matchAll(/"pageRequestId"\s*:\s*"([^"]*)"/g)].some(
    (match) => match[1] !== PAGE_REQUEST_ID_PLACEHOLDER,
  );
}

export function hasUnsafeConcreteCachedNonce(body: string): boolean {
  return [...body.matchAll(/ nonce="([^"]*)"/g)].some(
    (match) => match[1] !== CSP_NONCE_PLACEHOLDER,
  );
}

export function dynamicHtmlPlaceholders(): Readonly<{
  cspNonce: string;
  pageRequestId: string;
}> {
  return {
    cspNonce: CSP_NONCE_PLACEHOLDER,
    pageRequestId: PAGE_REQUEST_ID_PLACEHOLDER,
  };
}

function safeCspNonce(value: string | undefined): value is string {
  return value !== undefined && SAFE_CSP_NONCE.test(value);
}
