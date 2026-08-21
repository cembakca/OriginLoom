import {
  cachedHtmlDynamicValues,
  materializeCachedHtmlDynamicValues,
  normalizeCachedHtmlDynamicValues,
} from "./dynamic-html.js";

export { hasUnsafeConcreteCachedNonce } from "./dynamic-html.js";

/** Nonce value used while rendering a document intended for the shared cache. */
export function cachedHtmlCspNonce(nonce: string | undefined): string | undefined {
  return cachedHtmlDynamicValues({ cspNonce: nonce }).cspNonce;
}

/**
 * A shared HTML cache must never retain the nonce of the request that filled it.
 * Store a fixed marker instead; the marker is replaced only while producing the
 * response for the current request.
 */
export function normalizeCachedHtmlNonce(body: string, nonce: string | undefined): string {
  return normalizeCachedHtmlDynamicValues(body, { cspNonce: nonce });
}

/** Replace cache-safe nonce markers with the nonce authorized by this response's CSP header. */
export function materializeCachedHtmlNonce(body: string, nonce: string | undefined): string {
  return materializeCachedHtmlDynamicValues(body, { cspNonce: nonce });
}
