import { createHmac, timingSafeEqual } from "node:crypto";

import { cookie } from "@originloom/shared/lib/request";

import { config } from "./config.js";
import type { CookieJar } from "./middleware/cookie-jar.js";

/**
 * Draft mode: one editor sees unpublished content, everyone else sees the site.
 *
 * The dangerous part is not showing a draft — it is showing it to the wrong
 * person. Rendered HTML here is shared by every visitor, so a preview render
 * that reached the cache would serve unpublished content to the whole internet
 * until the entry expired. That is why the bypass lives in the platform and not
 * in each app: `previewCachePolicy` forces the policy to `none`, which turns off
 * the read, the write and the background revalidation in one move, and the
 * response goes out `private, no-store`.
 *
 * The cookie carries an expiry and a signature over it — never the secret. A
 * copied cookie stops working when it expires, and a forged one never starts.
 */
export const PREVIEW_COOKIE = "originloom_preview";

/** Cookie value: `<expiry-ms>.<hmac>`. */
const VALUE_PATTERN = /^(\d{1,15})\.([A-Za-z0-9_-]{20,})$/;

export type PreviewGrant = { value: string; expiresAt: number };

/**
 * Whether preview is configured at all.
 *
 * With no secret there is no way to tell an editor from anyone else, so the
 * feature stays off rather than falling back to something weaker.
 */
export function isPreviewConfigured(): boolean {
  return Boolean(config.previewSecret);
}

/**
 * Mints a grant for an editor who presented the shared secret.
 *
 * The returned value goes in an HttpOnly cookie: scripts on the page never need
 * it, and keeping it out of their reach means an XSS on the public site cannot
 * turn itself into a draft-content read.
 */
export function createPreviewGrant(now = Date.now()): PreviewGrant {
  const expiresAt = now + config.previewTtlMs;
  return { value: `${expiresAt}.${sign(String(expiresAt))}`, expiresAt };
}

/** Verifies the shared secret an editor presents to start a preview session. */
export function isValidPreviewToken(token: string | null | undefined): boolean {
  const secret = config.previewSecret;
  if (!secret || !token) return false;
  return constantTimeEquals(token, secret);
}

/**
 * Whether this request is in preview.
 *
 * Called on the hot path for every document, so it does the cheap checks first
 * and only reaches for HMAC when a well-formed cookie is actually present.
 */
export function isPreviewRequest(request: Request): boolean {
  if (!isPreviewConfigured()) return false;

  const raw = cookie(request, PREVIEW_COOKIE);
  if (!raw) return false;

  const parsed = VALUE_PATTERN.exec(raw);
  if (!parsed) return false;

  const [, expiry, signature] = parsed as unknown as [string, string, string];
  if (Number(expiry) <= Date.now()) return false;

  return constantTimeEquals(signature, sign(expiry));
}

/**
 * Downgrades a route's cache policy for a preview request.
 *
 * Returning `none` is what makes the whole feature safe: the caller computes no
 * cache key, so there is nothing to read, nothing to write and nothing to
 * revalidate in the background. A preview render cannot reach shared storage
 * even by accident.
 */
export function previewCachePolicy<T extends { kind: string }>(
  policy: T,
  request: Request,
): T | { kind: "none" } {
  return isPreviewRequest(request) ? { kind: "none" } : policy;
}

export function setPreviewCookie(jar: CookieJar, grant: PreviewGrant): void {
  jar.set(PREVIEW_COOKIE, grant.value, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: Math.max(0, Math.floor((grant.expiresAt - Date.now()) / 1000)),
  });
}

export function clearPreviewCookie(jar: CookieJar): void {
  jar.delete(PREVIEW_COOKIE);
}

function sign(payload: string): string {
  return createHmac("sha256", config.previewSecret ?? "")
    .update(payload)
    .digest("base64url");
}

/** Length-independent comparison: the digests hide how far the match got. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHmac("sha256", "compare").update(a).digest();
  const right = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(left, right);
}
