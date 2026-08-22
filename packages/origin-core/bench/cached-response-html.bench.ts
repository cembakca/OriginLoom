/**
 * Microbenchmark for the string work a *warm cache HIT* still performs before
 * the response goes out. Run with `pnpm --filter @originloom/core bench`.
 *
 * This exists because the cache primitives themselves
 * (`bench/cache-resource.bench.ts`) measure in hundreds of nanoseconds, while
 * this path measures in tens of *micro*seconds — two orders of magnitude more.
 * A cache-layer benchmark alone will therefore report a healthy warm path for
 * a page whose real per-hit cost is dominated by document-sized string
 * scanning, which is exactly the blind spot that let this cost land unnoticed.
 *
 * `materializeCachedHtmlDynamicValues` runs once for the whole document and
 * once per stitched fragment, so its cost scales with both page size and
 * fragment count. Every case below is a scan (and potentially a full copy) of
 * the body, so the numbers are meaningful in absolute microseconds, not only
 * as before/after ratios.
 */
import { bench, describe } from "vitest";

import {
  dynamicHtmlPlaceholders,
  materializeCachedHtmlDynamicValues,
} from "../src/cache/dynamic-html.js";

const { cspNonce: NONCE_MARKER, pageRequestId: REQUEST_ID_MARKER } = dynamicHtmlPlaceholders();

/** Roughly a real product page: ~128KB of markup around the two dynamic slots. */
function buildDocument(markers: boolean): string {
  const filler = '<div class="card"><p>lorem ipsum dolor sit amet consectetur</p></div>'.repeat(
    2_000,
  );
  const nonce = markers ? NONCE_MARKER : "r4nd0mn0nc3va1ue";
  const requestId = markers ? REQUEST_ID_MARKER : "0191f0c2-1111-7000-8000-abcdefabcdef";
  return `<!doctype html><html><head><script nonce="${nonce}"></script></head><body>${filler}<span data-request-id="${requestId}"></span></body></html>`;
}

/** A stitched fragment (menu, footer, banner): small, and carries no slot at all. */
const FRAGMENT_HTML = `<nav class="menu">${'<a href="/x">Menu</a>'.repeat(120)}</nav>`;

const DOCUMENT_WITH_MARKERS = buildDocument(true);
const DOCUMENT_WITHOUT_MARKERS = buildDocument(false);

const values = {
  cspNonce: "dGVzdC1ub25jZS12YWx1ZQ",
  pageRequestId: "0191f0c2-9d3e-7a41-b0c2-9d3e7a41b0c2",
};

describe("cache/dynamic-html.ts — warm HIT response materialization", () => {
  bench("document with both dynamic slots (the home-page HIT case)", () => {
    materializeCachedHtmlDynamicValues(DOCUMENT_WITH_MARKERS, values);
  });

  // A document whose slots were already materialized carries no marker. This
  // is the pure "what does the safety sweep cost when it finds nothing" case.
  bench("document with no dynamic slot (pure scan cost)", () => {
    materializeCachedHtmlDynamicValues(DOCUMENT_WITHOUT_MARKERS, values);
  });

  // Multiplied by the fragment count on every cached page that stitches.
  bench("stitched fragment body with no dynamic slot", () => {
    materializeCachedHtmlDynamicValues(FRAGMENT_HTML, values);
  });
});
