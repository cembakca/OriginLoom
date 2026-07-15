import { describe, expect, it } from "vitest";
import { redirectionStep } from "../../server/middleware/steps/redirection";
import { createInitialResult } from "../../server/middleware/sequential";
import type { PipelineContext } from "../../server/middleware/types";

describe("redirection step", () => {
  it("returns 410 for gone paths", async () => {
    const ctx: PipelineContext = {
      url: new URL("http://localhost/kaldirildi"),
      pathname: "/kaldirildi",
      publicPath: "/kaldirildi",
    };
    const acc = createInitialResult(new Request("http://localhost/kaldirildi"));
    const patch = await redirectionStep(ctx, acc);
    expect(patch?.response?.status).toBe(410);
  });

  it("returns redirect for CMS rules", async () => {
    const ctx: PipelineContext = {
      url: new URL("http://localhost/eski-emeklilik?ref=1"),
      pathname: "/eski-emeklilik",
      publicPath: "/eski-emeklilik",
    };
    const acc = createInitialResult(new Request("http://localhost/eski-emeklilik?ref=1"));
    const patch = await redirectionStep(ctx, acc);
    expect(patch?.response?.status).toBe(301);
  });
});
