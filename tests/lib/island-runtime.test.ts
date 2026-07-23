/** @vitest-environment jsdom */
import {
  bootstrapIslandElements,
  createIslandMountWatchdog,
  loadIslandModule,
} from "@originloom/react/lib/client/island-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("island client runtime", () => {
  it("mounts critical eager islands before falling back when IntersectionObserver is unavailable", () => {
    document.body.innerHTML = `
      <div data-island="layout-client" data-eager></div>
      <div data-island="page-analytics" data-eager></div>
      <div data-island="footer-accordion"></div>
    `;
    const mounted: string[] = [];

    bootstrapIslandElements(
      document.querySelectorAll<HTMLElement>("[data-island]"),
      (element) => mounted.push(element.dataset.island ?? "unknown"),
      { observer: null },
    );

    expect(mounted).toEqual(["layout-client", "page-analytics", "footer-accordion"]);
  });

  it("reports an overridden observer and mounts every lazy island once", () => {
    document.body.innerHTML = `
      <div data-island="layout-client" data-eager></div>
      <div data-island="mobile-menu"></div>
      <div data-island="footer-accordion"></div>
    `;
    const mounted: string[] = [];
    const observerError = vi.fn();
    const BrokenObserver = class {
      constructor() {
        throw new Error("observer overridden");
      }
    } as unknown as typeof IntersectionObserver;

    bootstrapIslandElements(
      document.querySelectorAll<HTMLElement>("[data-island]"),
      (element) => mounted.push(element.dataset.island ?? "unknown"),
      { observer: BrokenObserver, onObserverError: observerError },
    );

    expect(observerError).toHaveBeenCalledOnce();
    expect(mounted).toEqual(["layout-client", "mobile-menu", "footer-accordion"]);
  });

  it("retries one transient chunk failure under the same total timeout budget", async () => {
    vi.useFakeTimers();
    const module = { default: () => null };
    const load = vi
      .fn<() => Promise<typeof module>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce(module);

    const loading = loadIslandModule(load, {
      timeoutMs: 1_000,
      retryDelayMs: 50,
      shouldRetry: () => true,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(loading).resolves.toBe(module);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("classifies non-transient chunk failures without retrying", async () => {
    const load = vi.fn().mockRejectedValue(new SyntaxError("invalid module"));

    await expect(
      loadIslandModule(load, { timeoutMs: 100, shouldRetry: () => false }),
    ).rejects.toMatchObject({ failure: "chunk-load" });
    expect(load).toHaveBeenCalledOnce();
  });

  it("classifies a hanging island import as a mount timeout", async () => {
    vi.useFakeTimers();
    const loading = loadIslandModule(() => new Promise<never>(() => undefined), { timeoutMs: 50 });
    const rejected = expect(loading).rejects.toMatchObject({
      failure: "mount-timeout",
    });

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
  });

  it("reports a root that never commits and cancels the watchdog after commit", async () => {
    vi.useFakeTimers();
    const timedOut = vi.fn();
    const cancel = createIslandMountWatchdog(timedOut, 50);

    await vi.advanceTimersByTimeAsync(49);
    expect(timedOut).not.toHaveBeenCalled();
    cancel();
    await vi.advanceTimersByTimeAsync(1);
    expect(timedOut).not.toHaveBeenCalled();

    createIslandMountWatchdog(timedOut, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(timedOut).toHaveBeenCalledOnce();
  });
});
