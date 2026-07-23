import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResponsiveImage, UnoptimizedImage } from "~/components/ui/responsive-image";
import {
  buildImageCdnUrl,
  createCdnImage,
  createUnoptimizedImage,
  imagePreload,
  prefixMediaUrl,
} from "@originloom/react/lib/media";

describe("responsive media", () => {
  it("builds encoded CDN transformation URLs", () => {
    const url = buildImageCdnUrl({
      endpoint: "https://images.example.com/transform",
      src: "https://origin.example.com/a folder/hero.jpg",
      width: 768,
      quality: 80,
      format: "avif",
    });

    expect(url).toBe(
      "https://images.example.com/transform?url=https%3A%2F%2Forigin.example.com%2Fa+folder%2Fhero.jpg&w=768&q=80&format=avif",
    );
  });

  it("keeps intrinsic dimensions and emits responsive modern formats", () => {
    const image = createCdnImage({
      endpoint: "https://images.example.com/transform",
      src: "https://origin.example.com/hero.jpg",
      width: 1600,
      height: 900,
      widths: [1200, 480, 768, 768],
    });
    const html = renderToStaticMarkup(
      <ResponsiveImage image={image} sizes="(min-width: 1024px) 50vw, 100vw" priority alt="Hero" />,
    );

    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain("480w");
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');

    const preload = imagePreload(image, "50vw");
    expect(preload.imageSrcSet).toContain("format=avif");
    expect(preload.imageSizes).toBe("50vw");
  });

  it("keeps unoptimized images direct and supports a path-preserving CDN prefix", () => {
    const image = createUnoptimizedImage({
      src: "/assets/media/hero.svg",
      width: 1600,
      height: 900,
      cdnPrefix: "https://cdn.example.com/image-origin/",
    });
    const html = renderToStaticMarkup(<UnoptimizedImage image={image} alt="Direct hero" />);

    expect(image.src).toBe("https://cdn.example.com/image-origin/assets/media/hero.svg");
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("<picture");
  });

  it("does not prefix an already absolute unoptimized source", () => {
    expect(prefixMediaUrl("https://vendor.example.com/hero.jpg", "https://cdn.example.com")).toBe(
      "https://vendor.example.com/hero.jpg",
    );
  });
});
