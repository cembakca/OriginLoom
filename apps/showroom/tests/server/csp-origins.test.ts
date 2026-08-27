import { resolveCspSourceOrigins } from "@originloom/core/csp-origins";
import { describe, expect, it } from "vitest";

describe("CSP configured origins", () => {
  it("places asset and image CDNs in the directives that consume them", () => {
    expect(
      resolveCspSourceOrigins({
        assetCdnEnabled: true,
        assetCdnUrl: "https://assets.example.com/static",
        imageCdnUrl: "https://images.example.com/original",
        imageTransformUrl: "https://images.example.com/transform",
      }),
    ).toEqual({
      asset: ["https://assets.example.com"],
      image: ["https://assets.example.com", "https://images.example.com"],
    });
  });

  it("ignores the asset CDN while its explicit flag is disabled", () => {
    expect(
      resolveCspSourceOrigins({
        assetCdnEnabled: false,
        assetCdnUrl: "https://assets.example.com",
        imageCdnUrl: "https://images.example.com",
        imageTransformUrl: undefined,
      }),
    ).toEqual({ asset: [], image: ["https://images.example.com"] });
  });
});
