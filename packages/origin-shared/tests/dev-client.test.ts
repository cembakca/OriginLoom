import { createContext, runInContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { devClientPreamble } from "../src/dev-client.js";

type Sandbox = {
  window: { WebSocket: new (url: string, protocols?: string) => FakeSocket };
  reloads: number;
  fire: (type: string, event?: Record<string, unknown>) => void;
  NativeWebSocket: unknown;
};

type FakeSocket = {
  url: string;
  protocols: string | undefined;
  closed: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  close: () => void;
};

/**
 * Runs the preamble the way a browser would: a global `WebSocket` it can wrap,
 * page lifecycle events it can subscribe to, and a `location` it can reload.
 */
function runPreamble(): Sandbox {
  const listeners = new Map<string, Array<(event: unknown) => void>>();

  class NativeWebSocket {
    closed = false;
    private readonly handlers = new Map<string, Array<() => void>>();

    constructor(
      readonly url: string,
      readonly protocols?: string,
    ) {}

    addEventListener(type: string, listener: () => void): void {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
    }

    close(): void {
      this.closed = true;
      for (const handler of this.handlers.get("close") ?? []) handler();
    }
  }

  const sandbox = {
    window: { WebSocket: NativeWebSocket },
    NativeWebSocket,
    reloads: 0,
    location: {
      reload(): void {
        sandbox.reloads += 1;
      },
    },
    addEventListener(type: string, listener: (event: unknown) => void): void {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    fire(type: string, event: Record<string, unknown> = {}): void {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };

  runInContext(devClientPreamble(), createContext(sandbox));
  return sandbox as unknown as Sandbox;
}

describe("devClientPreamble", () => {
  it("closes Vite's socket before the page is frozen, so the browser never severs it", () => {
    const sandbox = runPreamble();
    const socket = new sandbox.window.WebSocket("ws://127.0.0.1:5010/?token=abc", "vite-hmr");

    expect(socket.closed).toBe(false);
    sandbox.fire("pagehide");
    expect(socket.closed).toBe(true);
  });

  it("closes the restart-polling socket too", () => {
    const sandbox = runPreamble();
    const socket = new sandbox.window.WebSocket("ws://127.0.0.1:5010/?token=abc", "vite-ping");

    sandbox.fire("pagehide");
    expect(socket.closed).toBe(true);
  });

  it("leaves application sockets alone", () => {
    const sandbox = runPreamble();
    const socket = new sandbox.window.WebSocket("wss://example.test/live", "market-stream");

    sandbox.fire("pagehide");
    expect(socket.closed).toBe(false);
  });

  it("reloads a page restored from the back/forward cache — its HMR socket is gone", () => {
    const sandbox = runPreamble();

    sandbox.fire("pageshow", { persisted: true });
    expect(sandbox.reloads).toBe(1);
  });

  it("does not reload an ordinary load", () => {
    const sandbox = runPreamble();

    sandbox.fire("pageshow", { persisted: false });
    expect(sandbox.reloads).toBe(0);
  });

  it("keeps the wrapper a WebSocket, so instanceof checks still hold", () => {
    const sandbox = runPreamble();
    const socket = new sandbox.window.WebSocket("ws://127.0.0.1:5010/", "vite-hmr");

    expect(socket).toBeInstanceOf(sandbox.NativeWebSocket as never);
  });
});
