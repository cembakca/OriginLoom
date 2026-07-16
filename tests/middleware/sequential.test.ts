import { createInitialResult, runSequential } from "@server/middleware/sequential";
import type { MiddlewareStep, PipelineContext } from "@server/middleware/types";
import { describe, expect, it, vi } from "vitest";

const ctx: PipelineContext = {
  url: new URL("http://localhost/test"),
  pathname: "/test",
  publicPath: "/test",
  clientIp: "127.0.0.1",
};

describe("runSequential", () => {
  it("accumulates request header patches across steps", async () => {
    const step1: MiddlewareStep = async (_ctx, acc) => {
      const headers = new Headers(acc.request.headers);
      headers.set("x-step", "1");
      return { request: new Request(acc.request.url, { headers }) };
    };
    const step2: MiddlewareStep = async (_ctx, acc) => {
      const headers = new Headers(acc.request.headers);
      headers.set("x-step", "2");
      return { request: new Request(acc.request.url, { headers }) };
    };

    const result = await runSequential(
      [step1, step2],
      ctx,
      createInitialResult(new Request("http://localhost/test")),
    );
    expect(result.request.headers.get("x-step")).toBe("2");
  });

  it("short-circuits on terminal response", async () => {
    const step1: MiddlewareStep = async () => ({
      response: new Response("stop", { status: 301 }),
    });
    const step2 = vi.fn<MiddlewareStep>();

    const result = await runSequential(
      [step1, step2],
      ctx,
      createInitialResult(new Request("http://localhost/test")),
    );

    expect(result.response?.status).toBe(301);
    expect(step2).not.toHaveBeenCalled();
  });

  it("merges cookies from steps", async () => {
    const step: MiddlewareStep = async (_ctx, acc) => {
      acc.cookies.set("a", "1");
      return { cookies: acc.cookies };
    };

    const result = await runSequential(
      [step],
      ctx,
      createInitialResult(new Request("http://localhost/test")),
    );
    expect(result.cookies.toHeaderStrings().some((c) => c.startsWith("a=1"))).toBe(true);
  });
});
