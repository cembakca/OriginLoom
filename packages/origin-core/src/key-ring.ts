import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing that survives a rotation.
 *
 * A single secret makes rotation a coin toss. Mid rolling deploy the two
 * releases hold different values, and every artefact signed by one is rejected
 * by the other: a preview link an editor opened a minute ago, an island
 * placeholder already in a rendered page. The rejection is correct given what
 * the verifier knows, and it is still an outage the rotation caused.
 *
 * The auth refresh codec already solved this for itself, with a
 * current/previous pair. This is that idea as a primitive, so the next thing
 * that needs it does not solve it a third way — and so the answer is one
 * sentence everywhere: **sign with current, accept any key still on the ring.**
 *
 * The `kid` is what makes acceptance cheap rather than a loop over every key:
 * a token names the key that signed it, so verification is one HMAC and a
 * constant-time compare, and an unknown `kid` is refused without work. It is
 * not a secret — it is a label, and labelling which key signed something is how
 * you retire that key on purpose instead of by guesswork.
 */
export type KeyRing = {
  /** Signs new artefacts. Exactly one, always. */
  readonly current: { readonly kid: string; readonly secret: string };
  /** Still accepted, never used to sign. Empty once a rotation has finished. */
  readonly retiring: readonly { readonly kid: string; readonly secret: string }[];
};

const KID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Builds a ring from the two values a deployment actually holds.
 *
 * Derives each `kid` from its secret rather than asking for one: an operator
 * rotating a secret at 3am should not also have to invent a label and keep it
 * in step, and a derived label cannot disagree with the key it names. Eight
 * characters of an HMAC over a fixed string — enough to distinguish the keys on
 * a ring, and it reveals nothing about the secret.
 */
export function keyRing(current: string, previous?: string): KeyRing {
  const trimmedCurrent = current.trim();
  if (!trimmedCurrent) throw new TypeError("keyRing needs a current secret");
  const trimmedPrevious = previous?.trim();
  return {
    current: { kid: deriveKid(trimmedCurrent), secret: trimmedCurrent },
    retiring:
      trimmedPrevious && trimmedPrevious !== trimmedCurrent
        ? [{ kid: deriveKid(trimmedPrevious), secret: trimmedPrevious }]
        : [],
  };
}

/** `<kid>.<signature>` — the label travels with the signature, not beside it. */
export function signWithRing(ring: KeyRing, payload: string): string {
  return `${ring.current.kid}.${hmac(ring.current.secret, payload)}`;
}

/**
 * True when `signature` was produced by a key still on the ring.
 *
 * A signature whose `kid` names no key on the ring is refused without an HMAC:
 * that is the retired key, and refusing it is the point of retiring it.
 */
export function verifyWithRing(ring: KeyRing, payload: string, signature: string): boolean {
  const separator = signature.indexOf(".");
  if (separator <= 0) return false;
  const kid = signature.slice(0, separator);
  const digest = signature.slice(separator + 1);
  if (!KID.test(kid) || !digest) return false;

  const key = [ring.current, ...ring.retiring].find((candidate) => candidate.kid === kid);
  if (!key) return false;
  return constantTimeEquals(hmac(key.secret, payload), digest);
}

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function deriveKid(secret: string): string {
  return createHmac("sha256", secret).update("originloom-kid").digest("base64url").slice(0, 8);
}

/**
 * Compares through a fixed-size digest so the lengths cannot differ.
 *
 * `timingSafeEqual` throws on mismatched lengths, and catching that would leak
 * the length through the difference between a throw and a false.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHmac("sha256", "compare").update(a).digest();
  const right = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(left, right);
}
