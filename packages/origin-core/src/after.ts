import { config } from "./config.js";
import { logError } from "./logger.js";
import { observeAfterTask } from "./metrics.js";
import { queueAfterTask, takeAfterTasks } from "./observability.js";

/**
 * Work that must happen because of a request, but that the caller must not wait
 * for: a bot visit logged upstream, an analytics beacon, a cache warm.
 *
 * The alternative people reach for is `void doIt()`. That works right up until
 * it doesn't — a floating promise is invisible to shutdown, so a rolling deploy
 * drops whatever was in flight, and its rejection surfaces as an unhandled
 * rejection with no request attached. `after()` keeps the same "don't block the
 * response" property and adds the two things the floating promise never had:
 * the task is drained on shutdown, and its failure is logged like any other.
 *
 * Tasks run once the route handler has produced its response, so nothing here
 * delays time-to-first-byte.
 */
export type AfterTask = {
  name: string;
  run: () => unknown;
};

const pending = new Set<Promise<void>>();

/**
 * Registers work to run after the response.
 *
 * Called outside a request — a warm-up, a scheduled job, a test — the work
 * starts immediately instead. Both paths end up tracked, so shutdown drains
 * them either way.
 */
export function after(run: () => unknown, options: { name?: string } = {}): void {
  const task: AfterTask = { name: options.name ?? "after", run };
  // Inside a request this parks the task until the response is out; outside one
  // there is nothing to wait for, so `takeAfterTasks` hands it straight back.
  if (!queueAfterTask(task)) start(task);
}

/**
 * Starts everything the current request parked. Called by the runtime once the
 * response exists — deliberately not awaited.
 */
export function flushAfterTasks(): void {
  for (const task of takeAfterTasks()) start(task);
}

/**
 * Waits for in-flight tasks during shutdown, up to a budget.
 *
 * Returns false when the budget ran out, so the caller can log that work was
 * dropped rather than pretending the drain was clean.
 */
export async function drainAfterTasks(timeoutMs: number): Promise<boolean> {
  if (pending.size === 0) return true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const completed = Promise.allSettled([...pending]).then(() => true);
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });

  const drained = await Promise.race([completed, deadline]);
  if (timer) clearTimeout(timer);
  return drained;
}

/** In-flight count, for metrics and tests. */
export function afterTasksInFlight(): number {
  return pending.size;
}

function start(task: AfterTask): void {
  // A capacity bound, not a queue: past the limit the task is refused loudly
  // rather than growing the set until the pod runs out of memory. Hitting this
  // means something is scheduling per-request work faster than it completes.
  if (pending.size >= config.afterTaskMaxInFlight) {
    observeAfterTask(task.name, "rejected");
    logError(new Error(`after() capacity reached, dropping task: ${task.name}`), {
      msg: "after task rejected",
      task: task.name,
      inFlight: pending.size,
    });
    return;
  }

  const settled = Promise.resolve()
    .then(task.run)
    .then(
      () => observeAfterTask(task.name, "ok"),
      (error: unknown) => {
        observeAfterTask(task.name, "failed");
        // The whole point: a failure here is a log line, never an unhandled
        // rejection that takes the process with it.
        logError(error, { msg: "after task failed", task: task.name });
      },
    )
    .finally(() => {
      pending.delete(settled);
    });

  pending.add(settled);
}
