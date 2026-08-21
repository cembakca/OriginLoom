import type { Ctx, LoaderResult, Route } from "@originloom/shared/lib/types";
import type { OriginRenderer } from "@originloom/shared/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderMetrics } from "../src/metrics.js";
import { installRuntime, type ShellDependencyPlan } from "../src/runtime.js";
import { createShellResolution, resolveTerminalShell } from "../src/shell-resolution.js";
import { executeRoute } from "../src/ssr/execute-route.js";
import { serveRoute } from "../src/ssr/serve-route.js";

type Facts = { path: string };
type Snapshot = { navigation: string };
type Targeted = Facts & Snapshot;
type Overlay = { secret: string };
type Shell = Targeted & Partial<Overlay>;

const assets = { js: "/entry.js", css: [], fonts: [] };
const terminalCases: Array<{ name: string; result: LoaderResult<never> }> = [
  { name: "redirect", result: { kind: "redirect", location: "/next" } },
  { name: "not-found", result: { kind: "notFound" } },
  {
    name: "error",
    result: {
      kind: "error",
      error: { code: "failed", message: "Failed" },
    },
  },
];

afterEach(() => {
  vi.useRealTimers();
});

describe("shell dependency plan", () => {
  it("starts the public shell dependency alongside the route loader", async () => {
    vi.useFakeTimers();
    const calls = counters();
    installPlannedRuntime(plan(calls, 100));
    const route = dataRoute("/parallel", 100);

    let settled = false;
    const execution = executeRoute(route, context("/parallel"), assets, "request").then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(settled).toBe(true);
    expect((await execution).body).toContain('"navigation":"public"');
    expect(calls.publicSnapshot).toBe(1);
    expect(renderMetrics()).toContain(
      'ssr_shell_dependency_total{dependency="public_snapshot",outcome="success"}',
    );
  });

  it.each(terminalCases)(
    "aborts speculative public shell work for $name terminal results",
    async ({ result }) => {
      let aborted = false;
      let started = false;
      const calls = counters();
      const dependencyPlan = plan(calls);
      dependencyPlan.loadPublicShellSnapshot = (_facts, { signal }) => {
        started = true;
        return new Promise<Snapshot>((_resolve, reject) => {
          const onAbort = () => {
            aborted = true;
            reject(abortError(signal));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
      };
      installPlannedRuntime(dependencyPlan);
      const route: Route = {
        path: "/terminal",
        loader: async () => result,
        Component: () => "unused",
      };

      const execution = await executeRoute(route, context("/terminal"), assets, "request");

      expect(execution.result.kind).toBe(result.kind);
      await vi.waitFor(() => expect(!started || aborted).toBe(true));
    },
  );

  it("builds terminal shell without starting the public snapshot", async () => {
    const calls = counters();
    installPlannedRuntime(plan(calls));

    const shell = await resolveTerminalShell(context("/missing"), "/missing");

    expect(shell).toEqual({ path: "/missing", navigation: "terminal" });
    expect(calls.publicSnapshot).toBe(0);
    expect(calls.terminal).toBe(1);
  });

  it("renders a not-found response without waiting for speculative public shell I/O", async () => {
    const calls = counters();
    const dependencyPlan = plan(calls);
    dependencyPlan.loadPublicShellSnapshot = (_facts, { signal }) =>
      new Promise<Snapshot>((_resolve, reject) => {
        const abort = () => reject(abortError(signal));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    installPlannedRuntime(dependencyPlan);
    const route: Route = {
      path: "/missing",
      loader: async () => ({ kind: "notFound" }),
      Component: () => "unused",
    };
    const routeCtx = context("/missing");

    const response = await serveRoute({
      request: routeCtx.request,
      url: routeCtx.url,
      route,
      routeCtx,
      policy: { kind: "none" },
      cacheKey: null,
      assets,
      requestId: undefined,
      started: Date.now(),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('"navigation":"terminal"');
    expect(calls.terminal).toBe(1);
  });

  it("never supplies request overlay to shared cache-fill or revalidation renders", async () => {
    const calls = counters();
    installPlannedRuntime(plan(calls));
    const route = dataRoute("/overlay", 0);

    const fill = await executeRoute(route, context("/overlay"), assets, "cache_fill");
    const revalidation = await executeRoute(route, context("/overlay"), assets, "revalidation");
    const request = await executeRoute(route, context("/overlay"), assets, "request");

    expect(fill.body).not.toContain("request-secret");
    expect(revalidation.body).not.toContain("request-secret");
    expect(request.body).toContain("request-secret");
    expect(calls.overlay).toBe(1);
  });

  it("memoizes every public shell stage inside one render resolution", async () => {
    const calls = counters();
    installPlannedRuntime(plan(calls));
    const resolution = createShellResolution(context("/dedupe"), "/dedupe");

    const [first, second] = await Promise.all([
      resolution.resolve({ includeRequestOverlay: false }),
      resolution.resolve({ includeRequestOverlay: false }),
    ]);

    expect(first).toBe(second);
    expect(calls).toMatchObject({ facts: 1, publicSnapshot: 1, targeting: 1, compose: 1 });
  });

  it("keeps the legacy buildShellData runtime contract working", async () => {
    let shellBuilds = 0;
    installRuntime({
      ...baseRuntime(),
      buildShellData: async (ctx) => {
        shellBuilds++;
        return { path: ctx.publicPath, navigation: "legacy" };
      },
    });

    const execution = await executeRoute(
      dataRoute("/legacy", 0),
      context("/legacy"),
      assets,
      "request",
    );

    expect(execution.body).toContain('"navigation":"legacy"');
    expect(shellBuilds).toBe(1);
  });
});

function counters() {
  return { facts: 0, publicSnapshot: 0, targeting: 0, overlay: 0, compose: 0, terminal: 0 };
}

function plan(
  calls: ReturnType<typeof counters>,
  publicDelayMs = 0,
): ShellDependencyPlan<Shell, Facts, Snapshot, Targeted, Overlay> {
  return {
    requestFacts: (ctx) => {
      calls.facts++;
      return { path: ctx.publicPath };
    },
    loadPublicShellSnapshot: async () => {
      calls.publicSnapshot++;
      if (publicDelayMs > 0) await delay(publicDelayMs);
      return { navigation: "public" };
    },
    buildTargetedShell: (snapshot, facts) => {
      calls.targeting++;
      return { ...facts, ...snapshot };
    },
    loadRequestOverlay: () => {
      calls.overlay++;
      return { secret: "request-secret" };
    },
    composeShell: ({ targetedShell, requestOverlay }) => {
      calls.compose++;
      return { ...targetedShell, ...(requestOverlay ?? {}) };
    },
    composeTerminalShell: ({ facts }) => {
      calls.terminal++;
      return { ...facts, navigation: "terminal" };
    },
  };
}

function installPlannedRuntime(
  shell: ShellDependencyPlan<Shell, Facts, Snapshot, Targeted, Overlay>,
): void {
  installRuntime({ ...baseRuntime(), shell });
}

function baseRuntime() {
  return {
    renderer: renderer(),
    fragments: {},
    isShellUsableForFragments: () => true,
    document: {
      htmlLang: "en",
      isBotRequest: () => false,
      resolveMetadata: () => ({}) as never,
      boundaryMetadata: () => ({}) as never,
      defaultPageMeta: (_ctx: Ctx, pageType: string) => ({ pageType, publicPath: "/" }),
    },
    cacheKeys: { isKnownPageCachePrefix: () => true },
  };
}

function renderer(): OriginRenderer<Shell> {
  return {
    routeContent: (_route, data) => data,
    notFoundContent: () => "not-found",
    errorContent: () => "error",
    renderNode: (node) => String(node),
    renderDocument: (input) => `<!DOCTYPE html>${JSON.stringify(input.shell)}`,
    renderDocumentToStream: async () => {
      throw new Error("streaming not used by this test");
    },
  };
}

function dataRoute(path: string, loaderDelayMs: number): Route<{ ok: true }> {
  return {
    path,
    loader: async () => {
      if (loaderDelayMs > 0) await delay(loaderDelayMs);
      return { data: { ok: true } };
    },
    Component: () => "content",
  };
}

function context(path: string): Ctx {
  const url = new URL(`http://localhost${path}`);
  return { request: new Request(url), params: {}, url, publicPath: path };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
