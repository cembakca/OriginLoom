import { renderMetrics } from "@server/metrics";
import { SsrCapacity, SsrCapacityError } from "@server/ssr-capacity";
import { describe, expect, it } from "vitest";

describe("SSR capacity", () => {
  it("bounds in-flight work and rejects a full queue", async () => {
    const capacity = new SsrCapacity(1, 1, 100);
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = capacity.run(new AbortController().signal, async () => {
      await gate;
      return "first";
    });
    const second = capacity.run(new AbortController().signal, async () => "second");

    expect(renderMetrics()).toContain("ssr_render_in_flight 1");
    expect(renderMetrics()).toContain("ssr_render_queue_depth 1");

    await expect(
      capacity.run(new AbortController().signal, async () => "third"),
    ).rejects.toMatchObject({ reason: "queue_full" });

    releaseFirst?.();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(renderMetrics()).toContain('ssr_render_rejections_total{reason="queue_full"}');
  });

  it("rejects requests that exhaust the queue wait budget", async () => {
    const capacity = new SsrCapacity(1, 1, 5);
    let releaseFirst: (() => void) | undefined;
    const first = capacity.run(new AbortController().signal, () => {
      return new Promise<string>((resolve) => {
        releaseFirst = () => resolve("done");
      });
    });

    const queued = capacity.run(new AbortController().signal, async () => "late");
    await expect(queued).rejects.toEqual(new SsrCapacityError("wait_timeout"));
    expect(renderMetrics()).toContain('ssr_render_rejections_total{reason="wait_timeout"}');

    releaseFirst?.();
    await expect(first).resolves.toBe("done");
  });
});
