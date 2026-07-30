import { createServer } from "node:http";

export async function startFakeGateway(routes) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const url = new URL(request.url ?? "/", "http://fake-gateway.invalid");
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...request.headers },
      body,
      json: parseJson(body),
    });
    const route = routes.find(
      (candidate) =>
        (candidate.method ?? "GET") === request.method && candidate.path === url.pathname,
    );
    if (!route) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"not_found"}');
      return;
    }
    if (route.delayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, route.delayMs));
    const headers =
      route.headers ??
      (route.body === undefined ? {} : { "content-type": "application/json; charset=utf-8" });
    response.writeHead(route.status ?? 200, headers);
    if (route.body === undefined) response.end();
    else response.end(typeof route.body === "string" ? route.body : JSON.stringify(route.body));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake gateway address unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  };
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1_048_576) throw new Error("fake gateway request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
