import { resolveTrustedClientIp } from "@originloom/core/client-ip";
import { describe, expect, it } from "vitest";

describe("trusted client IP resolution", () => {
  it("ignores forwarded headers unless TRUST_PROXY is enabled", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-real-ip": "203.0.113.11",
    });

    expect(
      resolveTrustedClientIp("10.0.0.20", headers, { enabled: false, hops: 1, cidrs: [] }),
    ).toBe("10.0.0.20");
    expect(
      resolveTrustedClientIp("10.0.0.20", headers, {
        enabled: true,
        hops: 2,
        cidrs: ["10.0.0.0/8"],
      }),
    ).toBe("203.0.113.10");
  });

  it("ignores forwarded headers when the socket peer is outside trusted proxy CIDRs", () => {
    expect(
      resolveTrustedClientIp("198.51.100.5", new Headers({ "x-forwarded-for": "203.0.113.10" }), {
        enabled: true,
        hops: 1,
        cidrs: ["10.0.0.0/8"],
      }),
    ).toBe("198.51.100.5");
  });

  it("falls back to the socket address for invalid proxy input", () => {
    expect(
      resolveTrustedClientIp(
        "10.0.0.20",
        new Headers({ "x-forwarded-for": "attacker-controlled" }),
        { enabled: true, hops: 1, cidrs: ["10.0.0.0/8"] },
      ),
    ).toBe("10.0.0.20");
  });
});
