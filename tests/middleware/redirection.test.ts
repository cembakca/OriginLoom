import { createInitialResult } from "@server/middleware/sequential";
import { redirectionStep } from "@server/middleware/steps/redirection";
import type { PipelineContext } from "@server/middleware/types";
import { describe, expect, it } from "vitest";

describe("redirection step", () => {
  it("returns 410 for gone paths", async () => {
    const ctx: PipelineContext = {
      url: new URL("http://localhost/kaldirildi"),
      pathname: "/kaldirildi",
      publicPath: "/kaldirildi",
      clientIp: "127.0.0.1",
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
      clientIp: "127.0.0.1",
    };
    const acc = createInitialResult(new Request("http://localhost/eski-emeklilik?ref=1"));
    const patch = await redirectionStep(ctx, acc);
    expect(patch?.response?.status).toBe(301);
  });
});
