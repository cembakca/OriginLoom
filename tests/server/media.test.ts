import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("server media delivery", () => {
  it("uses IMAGE_CDN_URL as a path-preserving direct asset prefix", async () => {
    process.env.IMAGE_CDN_URL = "https://cdn.example.com/image-origin";
    delete process.env.IMAGE_TRANSFORM_URL;
    vi.resetModules();
    const { responsiveImage, unoptimizedImage } = await import("@originloom/core/media");

    expect(unoptimizedImage("home-hero").src).toMatch(
      /^https:\/\/cdn\.example\.com\/image-origin\/assets\/media\/home-hero-source\./,
    );
    expect(responsiveImage("home-hero").srcSet).toContain(
      "https://cdn.example.com/image-origin/assets/media/home-hero-480.",
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
      "url=https%3A%2F%2Fcdn.example.com%2Fimage-origin%2Fassets%2Fmedia%2Fhome-hero-source.",
    );
    expect(unoptimizedImage("home-hero").src).not.toContain("/transform");
  });
});
