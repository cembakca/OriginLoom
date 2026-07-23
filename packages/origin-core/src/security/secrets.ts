import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time comparison without leaking whether candidate and secret lengths differ. */
export function secretMatches(candidate: string | null | undefined, secret: string): boolean {
  if (!candidate) return false;
  return timingSafeEqual(digest(candidate), digest(secret));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
