import { resolveTrustedClientIp } from "@server/client-ip";
import { describe, expect, it } from "vitest";

describe("trusted client IP resolution", () => {
  it("ignores forwarded headers unless TRUST_PROXY is enabled", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-real-ip": "203.0.113.11",
    });

    expect(resolveTrustedClientIp("10.0.0.20", headers, false)).toBe("10.0.0.20");
    expect(resolveTrustedClientIp("10.0.0.20", headers, true)).toBe("203.0.113.10");
  });

  it("falls back to the socket address for invalid proxy input", () => {
    expect(
      resolveTrustedClientIp(
        "10.0.0.20",
        new Headers({ "x-forwarded-for": "attacker-controlled" }),
        true,
      ),
    ).toBe("10.0.0.20");
  });
});
