import { once } from "node:events";

export default async function setup() {
  // Tooling bins resolve the app root from ORIGIN_APP_ROOT (vitest runs from the workspace root).
  const appRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  process.env.ORIGIN_APP_ROOT = appRoot;
  // Vitest runs from the workspace root; point the runtime at the app's client build.
  process.env.CLIENT_DIST_DIR = `${appRoot}/dist/client`;
  await import("@originloom/tooling/bin/build-media.mjs");
  process.env.MOCK_GW_QUIET = "1";
  const { createMockGatewayServer } = await import("../../../tools/mock-gw/server.js");
  const server = createMockGatewayServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock gateway failed to bind");
  process.env.GATEWAY_URL = `http://127.0.0.1:${address.port}`;

  return async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  };
}
