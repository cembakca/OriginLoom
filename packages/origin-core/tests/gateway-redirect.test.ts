import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, expect, it } from "vitest";

/**
 * An upstream that answers a gateway call with a redirect must not be able to
 * steer that call somewhere else.
 *
 * This is a server-side fetch: following the redirect would reach whatever host
 * the `Location` names — cloud metadata, an internal admin service — with the
 * pod's own network position, and hand the body back to a caller that may write
 * it into shared HTML. `redirect: "manual"` keeps the 3xx visible so
 * `requireGatewayOk` can reject it.
 */
let gateway: Server;
let elsewhere: Server;
let elsewhereHits = 0;

beforeAll(async () => {
  elsewhere = createServer((_request, response) => {
    elsewhereHits += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ secret: "never-meant-to-be-reachable" }));
  });
  await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
  const elsewherePort = (elsewhere.address() as { port: number }).port;

  gateway = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${elsewherePort}/metadata` });
    response.end();
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  process.env.GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
});

afterAll(() => {
  gateway.close();
  elsewhere.close();
});

it("does not follow an upstream redirect to another host", async () => {
  const { gatewayFetch } = await import("../src/adapters/gateway.js");

  const response = await gatewayFetch("/anything");

  expect(elsewhereHits).toBe(0);
  expect(response.status).toBe(302);
});
