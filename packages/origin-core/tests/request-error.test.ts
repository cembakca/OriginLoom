import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../src/logger.js";
import { reportRequestError } from "../src/request-error.js";
import { installRuntime, type OriginRuntime, tryGetRuntime } from "../src/runtime.js";

const original = tryGetRuntime();

/**
 * Only the two fields this function reads. A full runtime would be a fixture
 * about rendering, and this is a test about reporting.
 */
function runtimeWith(onRequestError: NonNullable<OriginRuntime["onRequestError"]>) {
  installRuntime({ ...(original ?? ({ fragments: {} } as never)), onRequestError });
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (original) installRuntime(original);
});

describe("reportRequestError", () => {
  /** The structured log line is the contract ops already depend on. */
  it("logs the failure with its context, hook or no hook", () => {
    const error = new Error("gateway exploded");

    reportRequestError({
      error,
      msg: "route execution failed",
      phase: "route",
      errorId: "err-1",
      requestId: "req-1",
      path: "/kasko",
      method: "GET",
      route: "/kasko",
    });

    // The label ops already grep for is a field, not something derived from the
    // phase — a phase name would have silently stopped matching their queries.
    expect(logger.error).toHaveBeenCalledWith(
      "gateway exploded",
      expect.objectContaining({
        msg: "route execution failed",
        phase: "route",
        errorId: "err-1",
        route: "/kasko",
      }),
    );
  });

  it("omits the fields this failure did not have rather than logging undefined", () => {
    reportRequestError({
      error: new Error("x"),
      msg: "global request failure",
      phase: "request",
      path: "/",
      method: "POST",
    });

    const fields = vi.mocked(logger.error).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(["phase", "path", "method"]));
    expect(fields).not.toHaveProperty("errorId");
    expect(fields).not.toHaveProperty("route");
  });

  /**
   * The id is the whole point: a ticket that says "it showed me err-1" has to
   * land on the same log line and the same report.
   */
  it("hands the app the error itself, with the reference the visitor was shown", () => {
    const reports: unknown[] = [];
    runtimeWith((report) => reports.push(report));
    const error = new Error("render failed");

    reportRequestError({
      error,
      msg: "stream shell render failed",
      phase: "render",
      errorId: "err-2",
      path: "/",
      method: "GET",
    });

    expect(reports).toEqual([
      {
        error,
        msg: "stream shell render failed",
        phase: "render",
        errorId: "err-2",
        path: "/",
        method: "GET",
      },
    ]);
  });

  /**
   * The hook's type is `() => void`, which TypeScript happily accepts an
   * `async` function for. Such a reporter rejects after `reportRequestError`
   * has returned — outside its `try` — so before this the failure escaped as an
   * unhandled rejection instead of the line below.
   */
  it("catches a reporter that rejects after it returns", async () => {
    // TypeScript itself accepts this — a `void` return type accepts any value —
    // and the shipped lint preset is what normally catches it. An app linting
    // with something else, or handing over a reporter typed `any`, still gets
    // here, which is why the guard exists behind the rule.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    runtimeWith(() => Promise.reject(new Error("sentry timed out")));

    reportRequestError({
      error: new Error("original"),
      msg: "route execution failed",
      phase: "route",
      path: "/",
      method: "GET",
    });
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.error).mock.calls[1]?.[0]).toBe("sentry timed out");
  });

  /** Nothing is awaited: the response path must not wait on a reporter's transport. */
  it("does not wait for a reporter that returns a promise", () => {
    let settled = false;
    runtimeWith(
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            settled = true;
            resolve();
          }, 20);
        }),
    );

    reportRequestError({
      error: new Error("original"),
      msg: "route execution failed",
      phase: "route",
      path: "/",
      method: "GET",
    });

    expect(settled).toBe(false);
  });

  /** A site with an extra field keeps it, so routing it here costs its log line nothing. */
  it("merges the fields a failure has and the others do not", () => {
    reportRequestError({
      error: new Error("island exploded"),
      msg: "server island render failed",
      phase: "render",
      path: "/api/_island",
      method: "GET",
      context: { island: "user-chrome" },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "island exploded",
      expect.objectContaining({ msg: "server island render failed", island: "user-chrome" }),
    );
  });

  /**
   * `context` may add, never rewrite. The canonical names are the log contract
   * this whole type exists to preserve — a `context.msg` that renamed
   * "route execution failed" would break the queries silently, which is the
   * exact failure the `msg` field was made a field to avoid.
   */
  it("refuses to let context rewrite a canonical field", () => {
    reportRequestError({
      error: new Error("island exploded"),
      msg: "server island render failed",
      phase: "render",
      path: "/api/_island",
      method: "GET",
      context: { msg: "something else", path: "/elsewhere", island: "user-chrome" },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "island exploded",
      expect.objectContaining({
        msg: "server island render failed",
        path: "/api/_island",
        island: "user-chrome",
      }),
    );
  });

  /** A canonical name this report left out stays out; context cannot supply it. */
  it("cannot invent a canonical field the failure did not have", () => {
    reportRequestError({
      error: new Error("x"),
      msg: "global request failure",
      phase: "request",
      path: "/",
      method: "POST",
      context: { errorId: "forged", route: "/forged" },
    });

    const fields = vi.mocked(logger.error).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields).not.toHaveProperty("errorId");
    expect(fields).not.toHaveProperty("route");
  });

  /** This runs on a path that is already failing; a bad reporter must not finish it off. */
  it("survives a reporter that throws, and says so once", () => {
    runtimeWith(() => {
      throw new Error("sentry is down");
    });

    expect(() =>
      reportRequestError({
        error: new Error("original"),
        msg: "route execution failed",
        phase: "route",
        path: "/",
        method: "GET",
      }),
    ).not.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.error).mock.calls[1]?.[0]).toBe("sentry is down");
  });
});
