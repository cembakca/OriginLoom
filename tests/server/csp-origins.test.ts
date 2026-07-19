import { resolveCspSourceOrigins } from "@server/csp-origins";
import { describe, expect, it } from "vitest";

describe("CSP configured origins", () => {
  it("places asset and image CDNs in the directives that consume them", () => {
    expect(
      resolveCspSourceOrigins({
        assetCdnUrl: "https://assets.example.com/static",
        imageCdnUrl: "https://images.example.com/original",
        imageTransformUrl: "https://images.example.com/transform",
      }),
    ).toEqual({
      asset: ["https://assets.example.com"],
      image: ["https://assets.example.com", "https://images.example.com"],
    });
  });
});
