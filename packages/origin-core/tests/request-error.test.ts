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
