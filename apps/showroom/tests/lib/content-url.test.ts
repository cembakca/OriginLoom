import {
  normalizeCanonicalUrl,
  normalizeMetadataImageUrl,
  normalizeNavigationUrl,
} from "@originloom/shared/lib/content-url";
import { describe, expect, it } from "vitest";

const siteUrl = "https://www.example.com";

describe("content URL policy", () => {
  it("accepts root-relative navigation and normalizes same-origin absolute URLs", () => {
    expect(normalizeNavigationUrl("/kredi?q=1#sonuc", { siteUrl })).toBe("/kredi?q=1#sonuc");
    expect(normalizeNavigationUrl("https://www.example.com/blog", { siteUrl })).toBe("/blog");
  });

  it("requires an explicit external contract and HTTPS for cross-origin navigation", () => {
    expect(normalizeNavigationUrl("https://partner.example/offer", { siteUrl })).toBeNull();
    expect(
      normalizeNavigationUrl("https://partner.example/offer", { siteUrl, external: true }),
    ).toBe("https://partner.example/offer");
    expect(
      normalizeNavigationUrl("http://partner.example/offer", { siteUrl, external: true }),
    ).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "//evil.example/path",
    "/safe\\@evil.example/path",
    " /space",
  ])("rejects unsafe navigation target %s", (value) => {
    expect(normalizeNavigationUrl(value, { siteUrl, external: true })).toBeNull();
  });

  it("pins canonical and og:url values to SITE_URL origin", () => {
    expect(normalizeCanonicalUrl("/blog#fragment", siteUrl)).toBe("https://www.example.com/blog");
    expect(normalizeCanonicalUrl("https://evil.example/blog", siteUrl)).toBeNull();
    expect(normalizeCanonicalUrl("//evil.example/blog", siteUrl)).toBeNull();
  });

  it("allows HTTPS image CDNs but rejects unsafe or insecure external image URLs", () => {
    expect(normalizeMetadataImageUrl("https://cdn.example/og.png", siteUrl)).toBe(
      "https://cdn.example/og.png",
    );
    expect(normalizeMetadataImageUrl("http://cdn.example/og.png", siteUrl)).toBeNull();
    expect(normalizeMetadataImageUrl("data:image/png;base64,AA", siteUrl)).toBeNull();
  });

  it("rejects content URLs longer than the contract limit", () => {
    expect(normalizeNavigationUrl(`/${"a".repeat(2_048)}`, { siteUrl })).toBeNull();
  });
});
