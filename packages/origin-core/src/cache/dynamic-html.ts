import { isSafeRequestId } from "../middleware/request-id.js";

/** Shared by every slot marker below — the gate for the whole materialize pass. */
const DYNAMIC_MARKER_PREFIX = "__ORIGINLOOM_";
/** Shared by every marker `UNKNOWN_DYNAMIC_PLACEHOLDER` can match. */
const UNKNOWN_DYNAMIC_PREFIX = "__ORIGINLOOM_DYNAMIC_";
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

/**
 * Materializes cache markers with values validated for the current response.
 *
 * This runs on the warm cache-HIT path for the whole document *and* once per
 * stitched fragment, so it is the single most size-sensitive function in the
 * cached-response path: every unguarded pass is a full scan plus a full copy
 * of the body. On a ~128KB document, the two defence-in-depth passes below
 * measured ~12µs of the ~33µs total, on every response, almost always finding
 * nothing.
 *
 * Both guards are exact, not heuristic. A `replaceAll(needle, …)` on a string
 * that does not contain `needle` is the identity function, and every marker
 * this function can act on begins with `DYNAMIC_MARKER_PREFIX`, so
 * short-circuiting on its absence cannot change the output for any input.
 */
export function materializeCachedHtmlDynamicValues(
  body: string,
  values: DynamicHtmlValues,
): string {
  // Most fragment bodies (menu, footer, banners) carry no dynamic slot at all.
  if (!body.includes(DYNAMIC_MARKER_PREFIX)) return body;

  let materialized = body;

  if (materialized.includes(CSP_NONCE_PLACEHOLDER)) {
    const nonce = safeCspNonce(values.cspNonce) ? values.cspNonce : undefined;
    materialized = nonce
      ? materialized.replaceAll(`nonce="${CSP_NONCE_PLACEHOLDER}"`, `nonce="${nonce}"`)
      : materialized.replaceAll(` nonce="${CSP_NONCE_PLACEHOLDER}"`, "");
    // A malformed marker outside the reviewed nonce attribute context is never
    // exposed to the browser as an internal implementation token. The pass
    // above already removed every well-formed one, so this normally has
    // nothing left to find — check before paying for the scan and the copy.
    if (materialized.includes(CSP_NONCE_PLACEHOLDER)) {
      materialized = materialized.replaceAll(CSP_NONCE_PLACEHOLDER, "");
    }
  }

  if (materialized.includes(PAGE_REQUEST_ID_PLACEHOLDER)) {
    const pageRequestId =
      values.pageRequestId && isSafeRequestId(values.pageRequestId) ? values.pageRequestId : "";
    materialized = materialized.replaceAll(PAGE_REQUEST_ID_PLACEHOLDER, pageRequestId);
  }

  // Unknown or damaged future slot markers fail closed instead of reaching the
  // client or being interpreted as real correlation values. Every marker this
  // regex can match starts with `UNKNOWN_DYNAMIC_PREFIX`, so the substring
  // check is a sound gate on running the (much more expensive) regex sweep.
  return materialized.includes(UNKNOWN_DYNAMIC_PREFIX)
    ? materialized.replace(UNKNOWN_DYNAMIC_PLACEHOLDER, "")
    : materialized;
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
