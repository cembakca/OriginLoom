import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayResponse } from "../src/adapters/gateway.js";

/**
 * The trace records every gateway call because `gatewayFetch` records it, not
 * because a wrapper remembered to. That distinction is the whole point: an app
 * that imports the gateway directly used to disappear from its own trace, and
 * four services in a real product had done exactly that.
 */
let gateway: Server;

beforeAll(async () => {
  gateway = createServer((request, response) => {
    if (request.url?.includes("boom")) {
      response.writeHead(503);
      response.end("no");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  process.env.GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
  process.env.SSR_DIAGNOSTICS = "1";
});

afterAll(() => {
  gateway.close();
  delete process.env.SSR_DIAGNOSTICS;
});

beforeEach(() => {
  vi.resetModules();
});

/** The shape the helper hands to each case; the module itself is imported fresh. */
type GatewayFetch = (path: string, init?: RequestInit) => Promise<GatewayResponse>;

async function traceFor(work: (gatewayFetch: GatewayFetch) => Promise<unknown>) {
  // Imported after the reset, like everything else here: a module captured
  // before it would be a different instance from the one the code under test
  // writes to, and the spy would watch the wrong logger.
  const { logger } = await import("../src/logger.js");
  const trace = await import("../src/diagnostics/request-trace.js");
  const { gatewayFetch } = await import("../src/adapters/gateway.js");
  const { withRequestSpan } = await import("../src/observability.js");
  const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

  await withRequestSpan(new Request("http://app.test/kasko"), "req-trace", async () => {
    trace.bindRequestPath("/kasko");
    await work(gatewayFetch).catch(() => undefined);
    // The trace only speaks up for a failure or a slow page; a healthy
    // request is not worth a log line.
    trace.logSsrOutcome({ request: new Request("http://app.test/kasko"), pageStatus: 500 });
  });

  // Read before restoring: `mockRestore` clears the recorded calls as well as
  // putting the original back.
  const entry = error.mock.calls.find(([message]) =>
    String(message).includes("ssr request failed"),
  );
  error.mockRestore();
  return entry;
}

describe("gateway calls record themselves", () => {
  it("records a successful call without any wrapper in the way", async () => {
    const entry = await traceFor(async (gatewayFetch) => {
      await using response = await gatewayFetch("/items");
      return response.status;
    });

    expect(JSON.stringify(entry)).toContain("/items");
  });

  it("records a failing status with a classification", async () => {
    const entry = await traceFor(async (gatewayFetch) => {
      await using response = await gatewayFetch("/boom");
      return response.status;
    });

    expect(JSON.stringify(entry)).toContain("/boom");
  });
});
