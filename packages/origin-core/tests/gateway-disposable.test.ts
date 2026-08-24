import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A gateway call that leaves its body unread holds an Undici socket until the
 * pool starves. The release is real work, so what matters is not that a helper
 * exists but that it runs on every way out of a call — including the ways an
 * author forgot about.
 */
let gateway: Server;
let served = 0;

beforeAll(async () => {
  gateway = createServer((_request, response) => {
    served += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  process.env.GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
});

afterAll(() => gateway.close());

describe("a gateway response is its own cleanup", () => {
  it("drains the body when the block ends normally", async () => {
    const { gatewayFetch } = await import("../src/adapters/gateway.js");

    let captured: Response;
    {
      await using response = await gatewayFetch("/normal");
      captured = response;
      expect(response.bodyUsed).toBe(false);
    }

    expect(captured.bodyUsed).toBe(true);
  });

  /** The path nobody writes a `finally` for: an early return past the parse. */
  it("drains the body when the block returns early", async () => {
    const { gatewayFetch } = await import("../src/adapters/gateway.js");

    let captured: Response | undefined;
    const unauthorized = async (): Promise<string> => {
      await using response = await gatewayFetch("/early-return");
      captured = response;
      if (response.ok) return "left without reading";
      return "read";
    };

    expect(await unauthorized()).toBe("left without reading");
    expect(captured?.bodyUsed).toBe(true);
  });

  it("drains the body when the block throws", async () => {
    const { gatewayFetch } = await import("../src/adapters/gateway.js");

    let captured: Response | undefined;
    const failing = async (): Promise<never> => {
      await using response = await gatewayFetch("/throws");
      captured = response;
      throw new Error("parse blew up before the body was read");
    };

    await expect(failing()).rejects.toThrow("parse blew up");
    expect(captured?.bodyUsed).toBe(true);
  });

  /** Migration has to be incremental, so both spellings must stay safe together. */
  it("stays idempotent when a call site also releases by hand", async () => {
    const { gatewayFetch, releaseGatewayResponse } = await import("../src/adapters/gateway.js");

    let captured: Response;
    {
      await using response = await gatewayFetch("/both");
      captured = response;
      await releaseGatewayResponse(response);
      expect(response.bodyUsed).toBe(true);
    }

    expect(captured.bodyUsed).toBe(true);
    expect(served).toBeGreaterThan(0);
  });
});
