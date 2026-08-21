import { EventEmitter } from "node:events";

import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDevReloadPlugin } from "../src/vite.js";

const GENERATION_HEADER = "x-originloom-dev-generation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDevReloadPlugin", () => {
  it("reloads once when the ready SSR process generation changes", async () => {
    let generation = "generation-a";
    vi.stubGlobal(
      "fetch",
      readyFetch(() => generation),
    );
    const harness = createHarness();

    configure(harness.server, { debounceMs: 0, pollIntervalMs: 2, maxWaitMs: 40 });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    generation = "generation-b";
    harness.watcher.emit("change", "/app/src/lib/cache-keys.ts");

    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(1));
    expect(harness.send).toHaveBeenCalledWith({ type: "full-reload" });
    harness.httpServer.emit("close");
  });

  it("leaves Vite HMR alone when the Node process generation stays the same", async () => {
    vi.stubGlobal(
      "fetch",
      readyFetch(() => "generation-a"),
    );
    const harness = createHarness();

    configure(harness.server, { debounceMs: 0, pollIntervalMs: 2, maxWaitMs: 20 });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    harness.watcher.emit("change", "/app/src/styles/globals.css");
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(harness.send).not.toHaveBeenCalled();
    expect(harness.warn).not.toHaveBeenCalled();
    harness.httpServer.emit("close");
  });

  it("uses shouldReload only as a fallback for generation-unaware servers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    const harness = createHarness();

    configure(harness.server, {
      shouldReload: (file) => file.includes("/server/"),
      debounceMs: 0,
      pollIntervalMs: 2,
      maxWaitMs: 20,
    });
    harness.watcher.emit("change", "/app/server/routes.ts");

    await waitFor(() => expect(harness.send).toHaveBeenCalledTimes(1));
    harness.httpServer.emit("close");
  });
});

function readyFetch(generation: () => string) {
  return vi.fn(async () => new Response("ok", { headers: { [GENERATION_HEADER]: generation() } }));
}

function createHarness() {
  const watcher = new EventEmitter();
  const httpServer = new EventEmitter();
  const send = vi.fn();
  const warn = vi.fn();
  const server = {
    watcher,
    httpServer,
    ws: { send },
    config: { logger: { warn } },
  } as unknown as ViteDevServer;
  return { server, watcher, httpServer, send, warn };
}

function configure(server: ViteDevServer, options: Parameters<typeof createDevReloadPlugin>[0]) {
  const configureServer = createDevReloadPlugin(options).configureServer as
    ((server: ViteDevServer) => unknown) | undefined;
  if (typeof configureServer !== "function") throw new Error("configureServer hook is missing");
  void configureServer(server);
}

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
