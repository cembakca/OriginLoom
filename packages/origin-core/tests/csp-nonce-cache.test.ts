import { describe, expect, it } from "vitest";

import {
  cachedHtmlCspNonce,
  hasUnsafeConcreteCachedNonce,
  materializeCachedHtmlNonce,
  normalizeCachedHtmlNonce,
} from "../src/cache/csp-nonce.js";

describe("cached HTML CSP nonces", () => {
  const rendered =
    '<!doctype html><script nonce="fill-nonce">one()</script><script nonce="fill-nonce">two()</script>';

  it("stores no request-specific nonce and materializes the response nonce", () => {
    const cached = normalizeCachedHtmlNonce(rendered, "fill-nonce");

    expect(cached).not.toContain("fill-nonce");
    expect(hasUnsafeConcreteCachedNonce(cached)).toBe(false);

    const response = materializeCachedHtmlNonce(cached, "hit-nonce");
    expect(response).toContain('<script nonce="hit-nonce">one()</script>');
    expect(response).toContain('<script nonce="hit-nonce">two()</script>');
    expect(response).not.toContain("__ORIGINLOOM_CSP_NONCE__");
  });

  it("renders cache-fill documents with the cache-safe marker from the outset", () => {
    expect(cachedHtmlCspNonce("request-nonce")).toBe("__ORIGINLOOM_CSP_NONCE__");
    expect(cachedHtmlCspNonce(undefined)).toBeUndefined();
  });

  it("identifies HTML produced by the pre-placeholder cache format", () => {
    expect(hasUnsafeConcreteCachedNonce(rendered)).toBe(true);
    expect(
      hasUnsafeConcreteCachedNonce(
        normalizeCachedHtmlNonce(rendered, "fill-nonce") + '<script nonce="other">x()</script>',
      ),
    ).toBe(true);
  });

  it("removes an unresolved internal marker when no CSP nonce exists", () => {
    const cached = normalizeCachedHtmlNonce(rendered, "fill-nonce");
    expect(materializeCachedHtmlNonce(cached, undefined)).toContain("<script>one()</script>");
  });
});
