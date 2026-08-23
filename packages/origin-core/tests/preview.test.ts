import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PreviewModule from "../src/preview.js";

const SECRET = "preview-secret-value-long-enough";

/** Config is read at import time, so each case needs a fresh module graph. */
async function loadPreview(): Promise<typeof PreviewModule> {
  vi.resetModules();
  return import("../src/preview.js");
}

let previous: string | undefined;

beforeEach(() => {
  previous = process.env.PREVIEW_SECRET;
  process.env.PREVIEW_SECRET = SECRET;
});

afterEach(() => {
  if (previous === undefined) delete process.env.PREVIEW_SECRET;
  else process.env.PREVIEW_SECRET = previous;
});

function requestWithCookie(value: string): Request {
  return new Request("http://test.local/page", {
    headers: { cookie: `originloom_preview=${value}` },
  });
}

describe("preview grants", () => {
  it("accepts the configured token and nothing else", async () => {
    const { isValidPreviewToken } = await loadPreview();

    expect(isValidPreviewToken(SECRET)).toBe(true);
    expect(isValidPreviewToken("wrong")).toBe(false);
    expect(isValidPreviewToken("")).toBe(false);
    expect(isValidPreviewToken(null)).toBe(false);
  });

  it("recognises a grant it just minted", async () => {
    const { createPreviewGrant, isPreviewRequest } = await loadPreview();

    expect(isPreviewRequest(requestWithCookie(createPreviewGrant().value))).toBe(true);
  });

  /**
   * The cookie carries an expiry and a signature over it, never the secret — so
   * a value lifted from one browser stops working on its own.
   */
  it("rejects a grant whose expiry has passed", async () => {
    const { createPreviewGrant, isPreviewRequest } = await loadPreview();
    const expired = createPreviewGrant(Date.now() - 7_200_000);

    expect(isPreviewRequest(requestWithCookie(expired.value))).toBe(false);
  });

  it("rejects a forged signature and a tampered expiry", async () => {
    const { createPreviewGrant, isPreviewRequest } = await loadPreview();
    const grant = createPreviewGrant();
    const [expiry, signature] = grant.value.split(".") as [string, string];

    expect(isPreviewRequest(requestWithCookie(`${expiry}.${"a".repeat(43)}`))).toBe(false);
    // Pushing the expiry out without re-signing must not extend the session.
    expect(isPreviewRequest(requestWithCookie(`${Number(expiry) + 86_400_000}.${signature}`))).toBe(
      false,
    );
  });

  it("rejects malformed cookie values", async () => {
    const { isPreviewRequest } = await loadPreview();

    for (const value of ["", "nonsense", "123", "abc.def", "."]) {
      expect(isPreviewRequest(requestWithCookie(value))).toBe(false);
    }
  });

  it("is off entirely when no secret is configured", async () => {
    const { createPreviewGrant } = await loadPreview();
    const grant = createPreviewGrant();

    delete process.env.PREVIEW_SECRET;
    const unconfigured = await loadPreview();

    expect(unconfigured.isPreviewConfigured()).toBe(false);
    expect(unconfigured.isPreviewRequest(requestWithCookie(grant.value))).toBe(false);
    expect(unconfigured.isValidPreviewToken(SECRET)).toBe(false);
  });
});

describe("previewCachePolicy", () => {
  /**
   * The guarantee the whole feature rests on. A preview render that reached
   * shared storage would serve unpublished content to everyone until the entry
   * expired, so the policy is downgraded before a key can exist.
   */
  it("downgrades a shared policy to none for a preview request", async () => {
    const { createPreviewGrant, previewCachePolicy } = await loadPreview();
    const shared = { kind: "shared" as const, ttl: 300, key: ["home"] };

    const downgraded = previewCachePolicy(shared, requestWithCookie(createPreviewGrant().value));

    expect(downgraded).toEqual({ kind: "none" });
  });

  it("leaves an ordinary request's policy untouched", async () => {
    const { previewCachePolicy } = await loadPreview();
    const shared = { kind: "shared" as const, ttl: 300, key: ["home"] };

    expect(previewCachePolicy(shared, new Request("http://test.local/"))).toBe(shared);
  });

  it("does not downgrade for a cookie that failed verification", async () => {
    const { previewCachePolicy } = await loadPreview();
    const shared = { kind: "shared" as const, ttl: 300, key: ["home"] };

    expect(previewCachePolicy(shared, requestWithCookie("999999999999.forged"))).toBe(shared);
  });
});
