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
  /**
   * Fields this failure has and the others do not — the island that threw, say.
   *
   * Here so that routing a call site through this function never costs its log
   * line a field: the whole premise is that every line comes out exactly as it
   * did before, and a site with one extra field would otherwise have to choose
   * between reporting and keeping it.
   *
   * Additive only. A key that collides with one of the canonical field names is
   * dropped rather than applied — the same premise cuts the other way, and a
   * `context.msg` that quietly renamed "route execution failed" would break the
   * queries this type exists to keep working.
   */
  context?: Record<string, string> | undefined;
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
/**
 * The names a report owns. `context` may not write any of them.
 *
 * Listed rather than derived from the object, because the point is to protect a
 * name even on a report that does not carry it: an absent `errorId` must stay
 * absent, not become whatever a caller put in `context`.
 */
const CANONICAL_FIELDS = new Set([
  "msg",
  "phase",
  "path",
  "method",
  "errorId",
  "requestId",
  "route",
]);

export function reportRequestError(report: RequestErrorReport): void {
  const { error, context, ...fields } = report;
  logError(error, { ...additionalFields(context), ...stripUndefined(fields) });

  const onRequestError = tryGetRuntime()?.onRequestError;
  if (!onRequestError) return;
  try {
    const returned: unknown = onRequestError(report);
    // The hook's type says `void`, and TypeScript still accepts an `async`
    // function for it — a `void` return type accepts any value. Such a reporter
    // rejects *after* this line, outside the `try`, where the failure surfaces
    // as an unhandled rejection instead of the log line below. So the promise is
    // caught if there is one; nothing is awaited, because this runs on a path
    // that is already failing and must not be made to wait on a transport.
    if (isThenable(returned))
      returned.then(undefined, (hookError) => hookFailed(hookError, report));
  } catch (hookError) {
    hookFailed(hookError, report);
  }
}

function hookFailed(hookError: unknown, report: RequestErrorReport): void {
  // Reported as its own failure rather than re-entering `reportRequestError`: a
  // reporter that always throws would otherwise recurse until the stack ends.
  logError(hookError, { msg: "onRequestError hook failed", path: report.path });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function additionalFields(context: Record<string, string> | undefined): Record<string, unknown> {
  if (!context) return {};
  return Object.fromEntries(
    Object.entries(context).filter(([name]) => !CANONICAL_FIELDS.has(name)),
  );
}

function stripUndefined(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
