import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppVariables } from "../src/middleware/request-id.js";
import type { RequestErrorReport } from "../src/request-error.js";
import { installRuntime, type OriginRuntime, tryGetRuntime } from "../src/runtime.js";

const SECRET = "server-island-secret-long-enough";
const originalRuntime = tryGetRuntime();
let previousSecret: string | undefined;

/**
 * An island that throws answers quietly — the page already rendered and the
 * visitor is looking at the fallback, so a 500 here degrades one hole. That
 * decision is about the *answer*. It used to also decide who heard about the
 * failure: the error went to `logError` and never to the app's reporter, so a
 * Sentry-shaped `onRequestError` saw every render failure except this one.
 */
describe("server island render failures", () => {
  beforeEach(() => {
    previousSecret = process.env.SERVER_ISLAND_SECRET;
    process.env.SERVER_ISLAND_SECRET = SECRET;
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.SERVER_ISLAND_SECRET;
    else process.env.SERVER_ISLAND_SECRET = previousSecret;
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalRuntime) installRuntime(originalRuntime);
  });

  it("reaches the app's reporter, and still answers with an empty fragment", async () => {
    // The secret is read when `config` is first evaluated, so the module graph
    // has to be rebuilt after the env is set — and the runtime has to be
    // installed into *that* graph, not the one this file imported.
    vi.resetModules();
    const { signServerIslandPayload } = await import("../src/server-island.js");
    const { mountServerIslandApi } = await import("../src/api/server-island.js");
    const { installRuntime: installIntoFreshGraph } = await import("../src/runtime.js");
    const { logger: freshLogger } = await import("../src/logger.js");
    vi.spyOn(freshLogger, "error").mockImplementation(() => undefined);

    const reports: RequestErrorReport[] = [];
    const onRequestError: NonNullable<OriginRuntime["onRequestError"]> = (report) => {
      reports.push(report);
    };
    installIntoFreshGraph({ ...(originalRuntime ?? ({ fragments: {} } as never)), onRequestError });

    const app = new Hono<{ Variables: AppVariables }>();
    mountServerIslandApi(app, {
      "visitor-summary": () => {
        throw new Error("island exploded");
      },
    });

    const token = signServerIslandPayload("visitor-summary", {});
    const response = await app.request(`/api/_island?p=${encodeURIComponent(token)}`);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      msg: "server island render failed",
      phase: "render",
      path: "/api/_island",
      // The field the old log line carried; routing through the report must not
      // cost it, which is what `context` is for.
      context: { island: "visitor-summary" },
    });
  });
});
