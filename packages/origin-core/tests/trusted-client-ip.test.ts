import { describe, expect, it } from "vitest";

import { resolveTrustedClientIp } from "../src/client-ip.js";

const PROXY = "10.0.0.1";
const options = { enabled: true, hops: 1, cidrs: ["10.0.0.0/8"] };

function resolve(forwarded: string | null, remote = PROXY, opts = options): string {
  const headers = new Headers();
  if (forwarded !== null) headers.set("x-forwarded-for", forwarded);
  return resolveTrustedClientIp(remote, headers, opts);
}

describe("resolveTrustedClientIp", () => {
  it("reads the client address from a chain a trusted proxy appended to", () => {
    expect(resolve("203.0.113.7")).toBe("203.0.113.7");
  });

  it("ignores the header entirely when the peer is not a trusted proxy", () => {
    expect(resolve("203.0.113.7", "198.51.100.9")).toBe("198.51.100.9");
  });

  it("ignores the header when trusted-proxy support is off", () => {
    expect(resolve("203.0.113.7", PROXY, { ...options, enabled: false })).toBe(PROXY);
  });

  /**
   * The guard that matters: a header carrying anything unparseable is discarded
   * whole. Dropping just the bad entries would repair a forged chain and then
   * count hops in it — the position would be measured against a list the caller
   * shaped, which is exactly what the hop count exists to prevent.
   */
  it("distrusts the whole header when any entry is not an address", () => {
    expect(resolve("not-an-ip, 203.0.113.7")).toBe(PROXY);
    expect(resolve("203.0.113.7, <script>")).toBe(PROXY);
    expect(resolve("::ffff:203.0.113.7, 1.2.3.4.5")).toBe(PROXY);
  });

  it("accepts an IPv4-mapped IPv6 entry, normalized", () => {
    expect(resolve("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("falls back to the peer when the chain is shorter than the hop count", () => {
    expect(resolve("203.0.113.7", PROXY, { ...options, hops: 5 })).toBe(PROXY);
  });

  it("falls back to the peer when no forwarding header is present", () => {
    expect(resolve(null)).toBe(PROXY);
  });

  it("does not trust a header when no proxy CIDR is configured", () => {
    expect(resolve("203.0.113.7", PROXY, { ...options, cidrs: [] })).toBe(PROXY);
  });
});
