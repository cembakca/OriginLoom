import { createRefreshCoordinationCodec } from "@originloom/core/middleware/steps/auth/refresh-coordination-crypto";
import { describe, expect, it } from "vitest";

describe("auth refresh coordination encryption", () => {
  it("writes with the current key and reads the previous key during rotation", () => {
    const oldCodec = createRefreshCoordinationCodec("old-secret-at-least-thirty-two-characters");
    const rotatedCodec = createRefreshCoordinationCodec(
      "new-secret-at-least-thirty-two-characters",
      "old-secret-at-least-thirty-two-characters",
    );
    const oldPayload = oldCodec.seal({
      kind: "success",
      access: "old-access-token",
      refresh: "old-rotated-refresh-token",
    });

    expect(rotatedCodec.open(oldPayload)).toEqual({
      kind: "success",
      access: "old-access-token",
      refresh: "old-rotated-refresh-token",
    });
    expect(oldCodec.open(rotatedCodec.seal({ kind: "unauthorized" }))).toBeNull();
  });

  it("rejects tampered or unavailable results", () => {
    const codec = createRefreshCoordinationCodec("coordination-secret-at-least-thirty-two-chars");
    const sealed = codec.seal({ kind: "unauthorized" });
    expect(codec.open(`${sealed}tampered`)).toBeNull();
    expect(codec.open(null)).toBeNull();
  });
});
