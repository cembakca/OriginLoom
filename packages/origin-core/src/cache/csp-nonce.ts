const CSP_NONCE_PLACEHOLDER = "__ORIGINLOOM_CSP_NONCE__";

/** Nonce value used while rendering a document intended for the shared cache. */
export function cachedHtmlCspNonce(nonce: string | undefined): string | undefined {
  return nonce === undefined ? undefined : CSP_NONCE_PLACEHOLDER;
}

/**
 * A shared HTML cache must never retain the nonce of the request that filled it.
 * Store a fixed marker instead; the marker is replaced only while producing the
 * response for the current request.
 */
export function normalizeCachedHtmlNonce(body: string, nonce: string | undefined): string {
  if (!nonce || !body.includes(`nonce="${nonce}"`)) return body;
  return body.replaceAll(`nonce="${nonce}"`, `nonce="${CSP_NONCE_PLACEHOLDER}"`);
}

/** Replace cache-safe nonce markers with the nonce authorized by this response's CSP header. */
export function materializeCachedHtmlNonce(body: string, nonce: string | undefined): string {
  if (!body.includes(CSP_NONCE_PLACEHOLDER)) return body;
  if (!nonce) {
    // A production cache entry must not accidentally expose its internal marker
    // as a usable nonce when served in another environment.
    return body.replaceAll(` nonce="${CSP_NONCE_PLACEHOLDER}"`, "");
  }
  return body.replaceAll(`nonce="${CSP_NONCE_PLACEHOLDER}"`, `nonce="${nonce}"`);
}

/** Old cache entries contain a concrete per-request nonce and must be refilled. */
export function hasUnsafeConcreteCachedNonce(body: string): boolean {
  return [...body.matchAll(/ nonce="([^"]*)"/g)].some(
    (match) => match[1] !== CSP_NONCE_PLACEHOLDER,
  );
}
