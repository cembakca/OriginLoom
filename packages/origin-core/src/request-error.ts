import { logError } from "./logger.js";
import { tryGetRuntime } from "./runtime.js";

/**
 * A server-side failure a visitor actually hit, with the context needed to find
 * it again.
 *
 * `errorId` is the reference the error page showed them. It is the whole point
 * of the type: a support ticket that says "it said 8f3c-…" has to land on one
 * log line and one report, and that only works if the same id reaches both.
 */
export type RequestErrorReport = {
  error: unknown;
  /**
   * The label that already identifies this failure in the logs.
   *
   * Kept as a field rather than derived from `phase`, because these strings are
   * what existing log queries and alerts match on — "route execution failed"
   * has readers, and a phase name would silently stop matching them.
   */
  msg: string;
  /** Where the failure happened, which decides how much of the page existed. */
  phase: "request" | "route" | "render" | "stream";
  path: string;
  method: string;
  /** The reference shown to the visitor, when an error page was rendered. */
  errorId?: string | undefined;
  requestId?: string | undefined;
  /** The matched route pattern, when the request got far enough to have one. */
  route?: string | undefined;
};

/**
 * The one place an unexpected server error goes.
 *
 * Before this, reporting was whatever each catch block happened to call — five
 * `logError` sites with five different field sets, and nowhere for an app to
 * attach Sentry without patching the platform. Every one of those log lines
 * still comes out the same, on purpose; what is new is that the same report
 * also reaches the runtime, so an app registers its reporter once instead of
 * wrapping every entry point.
 *
 * Deliberately synchronous and deliberately swallowing. This runs on the path
 * that is already failing: a reporter that throws, or that returns a promise
 * nobody awaits, must not turn a rendered error page into no page at all.
 */
export function reportRequestError(report: RequestErrorReport): void {
  const { error, ...fields } = report;
  logError(error, stripUndefined(fields));

  const onRequestError = tryGetRuntime()?.onRequestError;
  if (!onRequestError) return;
  try {
    onRequestError(report);
  } catch (hookError) {
    // Reported as its own failure rather than re-entering this function: a
    // reporter that always throws would otherwise recurse until the stack ends.
    logError(hookError, { msg: "onRequestError hook failed", path: report.path });
  }
}

function stripUndefined(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
