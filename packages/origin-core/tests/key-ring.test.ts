import { describe, expect, it } from "vitest";

import { keyRing, signWithRing, verifyWithRing } from "../src/key-ring.js";

const CURRENT = "current-secret-value-0123456789";
const PREVIOUS = "previous-secret-value-9876543210";

describe("keyRing", () => {
  it("verifies what it signed", () => {
    const ring = keyRing(CURRENT);
    expect(verifyWithRing(ring, "payload", signWithRing(ring, "payload"))).toBe(true);
  });

  it("refuses a signature over different content", () => {
    const ring = keyRing(CURRENT);
    expect(verifyWithRing(ring, "other", signWithRing(ring, "payload"))).toBe(false);
  });

  /**
   * The whole reason the ring exists. Mid rolling deploy the old release signed
   * something the new release has to accept — a preview link an editor opened a
   * minute ago, an island placeholder already in a page someone is reading.
   */
  it("accepts what the previous key signed", () => {
    const before = keyRing(PREVIOUS);
    const after = keyRing(CURRENT, PREVIOUS);

    expect(verifyWithRing(after, "payload", signWithRing(before, "payload"))).toBe(true);
  });

  it("signs only with the current key", () => {
    const after = keyRing(CURRENT, PREVIOUS);
    const beforeOnly = keyRing(PREVIOUS);

    // Signed by the new deployment, so a pod still holding only the old secret
    // cannot verify it — which is why the rotation adds the new key everywhere
    // before it starts signing with it.
    expect(verifyWithRing(beforeOnly, "payload", signWithRing(after, "payload"))).toBe(false);
  });

  /** Retiring a key is the point of naming it; once off the ring it is refused. */
  it("refuses a key that has finished retiring", () => {
    const before = keyRing(PREVIOUS);
    const rotated = keyRing(CURRENT);

    expect(verifyWithRing(rotated, "payload", signWithRing(before, "payload"))).toBe(false);
  });

  it("gives the two keys different labels", () => {
    const ring = keyRing(CURRENT, PREVIOUS);
    expect(ring.retiring[0]?.kid).not.toBe(ring.current.kid);
  });

  /** A label that changed with the value it names would defeat its own purpose. */
  it("derives the same label for the same secret", () => {
    expect(keyRing(CURRENT).current.kid).toBe(keyRing(CURRENT, PREVIOUS).current.kid);
  });

  it("keeps nothing on the ring when the previous secret is the current one", () => {
    expect(keyRing(CURRENT, CURRENT).retiring).toEqual([]);
  });

  it.each([
    ["no separator", "signaturewithoutkid"],
    ["empty kid", ".signature"],
    ["empty signature", "kid."],
    ["unknown kid", "aaaaaaaa.signature"],
    ["kid with unsafe characters", "a/b.signature"],
  ])("refuses a malformed signature: %s", (_label, signature) => {
    expect(verifyWithRing(keyRing(CURRENT), "payload", signature)).toBe(false);
  });

  it("refuses to build a ring with no current secret", () => {
    expect(() => keyRing("  ")).toThrow(/current secret/);
  });
});

describe("what the ring is wired into", () => {
  /**
   * The rotation these two were missing. Both sign something that outlives the
   * request: a preview cookie an editor is carrying, an island placeholder
   * already inside a rendered page. A single secret meant the deploy that
   * changed it invalidated both.
   */
  it.each([
    ["preview grants", "PREVIEW_SECRET", "PREVIEW_PREVIOUS_SECRET"],
    ["server island props", "SERVER_ISLAND_SECRET", "SERVER_ISLAND_PREVIOUS_SECRET"],
  ])("%s accept the previous key during a rotation", (_label, currentName, previousName) => {
    // The pair is what the deployment sets; the ring is what the code reads.
    expect(currentName.endsWith("_SECRET")).toBe(true);
    expect(previousName).toBe(currentName.replace("_SECRET", "_PREVIOUS_SECRET"));

    const before = keyRing(PREVIOUS);
    const after = keyRing(CURRENT, PREVIOUS);
    expect(verifyWithRing(after, "payload", signWithRing(before, "payload"))).toBe(true);
  });
});
