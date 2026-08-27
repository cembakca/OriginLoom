import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

beforeEach(() => {
  process.env.ASSET_NAMESPACE = "revolt";
  delete process.env.ASSET_CDN_ENABLED;
  delete process.env.ASSET_CDN_URL;
  vi.resetModules();
});

describe("server media delivery", () => {
  it("uses IMAGE_CDN_URL as a path-preserving direct asset prefix", async () => {
    process.env.IMAGE_CDN_URL = "https://cdn.example.com/image-origin";
    delete process.env.IMAGE_TRANSFORM_URL;
    vi.resetModules();
    const { responsiveImage, unoptimizedImage } = await import("@originloom/core/media");

    expect(unoptimizedImage("home-hero").src).toMatch(
      /^https:\/\/cdn\.example\.com\/image-origin\/revolt\/assets\/media\/home-hero-source\./,
    );
    expect(responsiveImage("home-hero").srcSet).toContain(
      "https://cdn.example.com/image-origin/revolt/assets/media/home-hero-480.",
    );
    expect(responsiveImage("home-hero").srcSet).not.toContain("format=");
  });

  it("uses IMAGE_TRANSFORM_URL only for responsive candidates", async () => {
    process.env.IMAGE_CDN_URL = "https://cdn.example.com/image-origin";
    process.env.IMAGE_TRANSFORM_URL = "https://images.example.com/transform";
    vi.resetModules();
    const { responsiveImage, unoptimizedImage } = await import("@originloom/core/media");

    const responsive = responsiveImage("home-hero");
    expect(responsive.srcSet).toContain("https://images.example.com/transform?");
    expect(responsive.srcSet).toContain("format=jpg");
    expect(responsive.srcSet).toContain(
      "url=https%3A%2F%2Fcdn.example.com%2Fimage-origin%2Frevolt%2Fassets%2Fmedia%2Fhome-hero-source.",
    );
    expect(unoptimizedImage("home-hero").src).not.toContain("/transform");
  });
});

/**
 * The four fixed-purpose SEO images used to be written under stable names and
 * referenced as string literals from every app. That put mutable files inside
 * the namespace the server hands out with `max-age=31536000, immutable` — a
 * promise those filenames could not keep, and the delivery plan rules out query
 * versioning as the escape hatch. They are content-hashed now, which means the
 * manifest is the only thing that knows their names.
 */
describe("SEO assets", () => {
  it("content-hashes all four so the immutable cache header is honest", async () => {
    const { seoAssets } = await import("@originloom/core/media");
    const seo = seoAssets();

    expect(seo.openGraph.src).toMatch(/^\/revolt\/assets\/media\/og-default\.[0-9a-f]{12}\.jpg$/);
    expect(seo.brandLogo.src).toMatch(
      /^\/revolt\/assets\/media\/brand-logo-512\.[0-9a-f]{12}\.png$/,
    );
    expect(seo.appleTouchIcon.src).toMatch(
      /^\/revolt\/assets\/media\/apple-touch-icon\.[0-9a-f]{12}\.png$/,
    );
    expect(seo.favicon.src).toMatch(/^\/revolt\/assets\/media\/favicon-32\.[0-9a-f]{12}\.png$/);
  });

  it("reports the intrinsic size each one was generated at", async () => {
    const { seoAssets } = await import("@originloom/core/media");
    const seo = seoAssets();

    expect(seo.openGraph).toMatchObject({ width: 1200, height: 630 });
    expect(seo.brandLogo).toMatchObject({ width: 512, height: 512 });
    expect(seo.appleTouchIcon).toMatchObject({ width: 180, height: 180 });
    expect(seo.favicon).toMatchObject({ width: 32, height: 32 });
  });

  it("follows the asset CDN switch like every other built asset", async () => {
    process.env.ASSET_CDN_ENABLED = "true";
    process.env.ASSET_CDN_URL = "https://cdn.example.com";
    vi.resetModules();
    const { seoAssets } = await import("@originloom/core/media");

    expect(seoAssets().openGraph.src).toMatch(
      /^https:\/\/cdn\.example\.com\/revolt\/assets\/media\/og-default\./,
    );
  });
});
