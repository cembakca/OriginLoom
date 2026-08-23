import { afterEach, describe, expect, it, vi } from "vitest";

import { after, afterTasksInFlight, drainAfterTasks, flushAfterTasks } from "../src/after.js";
import { withRequestSpan } from "../src/observability.js";

const logger = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("../src/logger.js", () => ({ logError: logger.logError, logger: { error: vi.fn() } }));

function request(): Request {
  return new Request("http://test.local/page");
}

/** Runs `work` with a request context, the way the runtime does. */
function inRequest<T>(work: () => Promise<T> | T): Promise<T> {
  return withRequestSpan(request(), "req-1", async () => work());
}

afterEach(async () => {
  await drainAfterTasks(1_000);
  logger.logError.mockClear();
});

describe("after()", () => {
  it("does not run the task before the response is flushed", async () => {
    const ran = vi.fn();

    await inRequest(() => {
      after(ran, { name: "beacon" });
      // Still parked: the whole point is that the response does not wait.
      expect(ran).not.toHaveBeenCalled();
    });

    expect(ran).not.toHaveBeenCalled();
  });

  it("runs parked tasks once flushed, in the order they were registered", async () => {
    const order: string[] = [];

    await inRequest(() => {
      after(() => order.push("first"), { name: "first" });
      after(() => order.push("second"), { name: "second" });
      flushAfterTasks();
    });
    await drainAfterTasks(1_000);

    expect(order).toEqual(["first", "second"]);
  });

  it("runs immediately when there is no request in scope", async () => {
    const ran = vi.fn();

    after(ran, { name: "warmup" });
    await drainAfterTasks(1_000);

    expect(ran).toHaveBeenCalledOnce();
  });

  /**
   * The reason this primitive exists. A floating `void promise()` rejects into
   * nothing; here the failure is a log line and the process is untouched.
   */
  it("logs a failing task instead of leaving an unhandled rejection", async () => {
    const boom = new Error("upstream refused");

    await inRequest(() => {
      after(() => Promise.reject(boom), { name: "store-bot" });
      flushAfterTasks();
    });
    await drainAfterTasks(1_000);

    expect(logger.logError).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ task: "store-bot" }),
    );
  });

  it("logs a task that throws synchronously", async () => {
    await inRequest(() => {
      after(
        () => {
          throw new Error("bad argument");
        },
        { name: "sync" },
      );
      flushAfterTasks();
    });
    await drainAfterTasks(1_000);

    expect(logger.logError).toHaveBeenCalledOnce();
  });

  it("releases the queue on flush so a second flush is a no-op", async () => {
    const ran = vi.fn();

    await inRequest(() => {
      after(ran, { name: "once" });
      flushAfterTasks();
      flushAfterTasks();
    });
    await drainAfterTasks(1_000);

    expect(ran).toHaveBeenCalledOnce();
  });

  it("keeps one request's tasks out of another's", async () => {
    const first = vi.fn();
    const second = vi.fn();

    await inRequest(() => {
      after(first, { name: "first" });
    });
    // A different request flushing must not pick up what the first parked.
    await inRequest(() => {
      after(second, { name: "second" });
      flushAfterTasks();
    });
    await drainAfterTasks(1_000);

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});

describe("drainAfterTasks()", () => {
  it("waits for work that is still in flight", async () => {
    let done = false;

    await inRequest(() => {
      after(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          done = true;
        },
        { name: "slow" },
      );
      flushAfterTasks();
    });

    expect(afterTasksInFlight()).toBe(1);
    expect(await drainAfterTasks(1_000)).toBe(true);
    expect(done).toBe(true);
    expect(afterTasksInFlight()).toBe(0);
  });

  /**
   * Shutdown has a budget. Reporting `false` lets the caller say work was
   * dropped rather than logging a clean shutdown that wasn't one.
   */
  it("reports false when the budget runs out", async () => {
    await inRequest(() => {
      after(() => new Promise((resolve) => setTimeout(resolve, 500)), { name: "stuck" });
      flushAfterTasks();
    });

    expect(await drainAfterTasks(20)).toBe(false);
  });

  it("is a no-op with nothing in flight", async () => {
    expect(await drainAfterTasks(0)).toBe(true);
  });
});
