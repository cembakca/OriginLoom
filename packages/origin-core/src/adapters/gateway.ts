import { config } from "../config.js";
import { gatewayTransportFetch } from "../gateway-transport.js";
import { observeGatewayRequest } from "../metrics.js";
import {
  activeRequestId,
  injectActiveTrace,
  SpanKind,
  SpanStatusCode,
  withSpan,
} from "../observability.js";
import { applyGatewayIdentity, readGatewayIdentity } from "./gateway-identity.js";

/**
 * A gateway response that releases its own socket.
 *
 * `releaseGatewayResponse` has to run on every path out of a call, including the
 * ones nobody thought about: an early return, a throw between the status check
 * and the parse. `try`/`finally` says that, but only for an author who remembers
 * to write it — and a missing `finally` reads exactly like a correct one right
 * up until the connection pool runs dry under load, far from the code that lost
 * the socket.
 *
 * `await using` moves the guarantee from the author to the language. The
 * declaration is the cleanup, and there is no branch out of the block that can
 * skip it:
 *
 * ```ts
 * await using response = await gatewayFetchWithIdentity(request, path);
 * await requireGatewayOk(response, "Lookup gateway returned");
 * return parse(await readGatewayJson(response, contract, INVALID));
 * ```
 *
 * Disposal is idempotent, so an existing `try`/`finally` around the same
 * response keeps doing exactly what it did and a call site can move over on its
 * own schedule.
 */
export type GatewayResponse = Response & AsyncDisposable;

export function gatewayUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${config.gatewayUrl}${p}`;
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<GatewayResponse> {
  const url = new URL(gatewayUrl(path));
  return withSpan(
    `gateway ${init.method ?? "GET"} ${url.pathname}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": init.method ?? "GET",
        "server.address": url.hostname,
        "server.port": Number(url.port || (url.protocol === "https:" ? 443 : 80)),
        "url.path": url.pathname,
      },
    },
    async (span) => {
      const started = performance.now();
      const timeout = AbortSignal.timeout(config.gatewayTimeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      const headers = new Headers(init.headers);
      injectActiveTrace(headers);
      const requestId = activeRequestId();
      if (requestId && !headers.has("correlationid")) headers.set("correlationid", requestId);

      try {
        const response = await gatewayTransportFetch(url, {
          ...init,
          headers,
          signal,
          // Never follow an upstream redirect. Following one lets whatever
          // answered this call steer a *server-side* request at a host the app
          // never named — cloud metadata, an internal admin service — and hand
          // the body back to a caller that may write it into shared HTML.
          // `requireGatewayOk` turns the 3xx into a visible failure instead.
          // `proxyRequest` has always done this; this is the same rule for the
          // path every service actually uses.
          redirect: "manual",
        });
        const outcome =
          response.status >= 500
            ? "server_error"
            : response.status >= 400
              ? "client_error"
              : "success";
        span.setAttribute("http.response.status_code", response.status);
        span.setAttribute("gateway.outcome", outcome);
        if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        observeGatewayRequest(response.status, performance.now() - started, outcome);
        return asGatewayResponse(response);
      } catch (error) {
        const outcome = timeout.aborted || isUndiciTimeout(error) ? "timeout" : "network_error";
        span.setAttribute("gateway.outcome", outcome);
        observeGatewayRequest(0, performance.now() - started, outcome);
        throw error;
      }
    },
  );
}

/**
 * Attaches the release to the response itself.
 *
 * Defined on the instance rather than wrapped in a class, because every caller
 * and every helper here already speaks `Response`; a wrapper would buy the same
 * guarantee at the cost of changing the type the whole codebase passes around.
 *
 * Exported for test doubles. A fake gateway that hands back a bare `Response`
 * gives an `await using` call site nothing to dispose, and the resulting
 * TypeError surfaces as whatever that code does when the gateway misbehaves —
 * a fallback, a swallowed warning — rather than as the contract mismatch it is.
 */
export function asGatewayResponse(response: Response): GatewayResponse {
  return Object.defineProperty(response, Symbol.asyncDispose, {
    value: () => releaseGatewayResponse(response),
    configurable: true,
  }) as GatewayResponse;
}

/**
 * Consumes a small unused response so Undici can return its socket to the pool.
 * Oversized error bodies are cancelled instead of being buffered without limit.
 *
 * Prefer `await using` over calling this by hand — see {@link GatewayResponse}.
 * It stays exported because disposal has to be idempotent anyway, and because a
 * response that did not come from this module has no dispose method to call.
 */
export async function releaseGatewayResponse(response: Response, maxBytes = 65_536): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    await reader.cancel().catch(() => undefined);
  }
}

export async function requireGatewayOk(response: Response, message: string): Promise<void> {
  if (response.ok) return;
  const status = response.status;
  await releaseGatewayResponse(response);
  throw new Error(`${message} ${status}`);
}

function isUndiciTimeout(error: unknown): boolean {
  const direct = errorCode(error);
  const cause =
    error && typeof error === "object" && "cause" in error ? errorCode(error.cause) : undefined;
  return [direct, cause].some((code) =>
    ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(
      code ?? "",
    ),
  );
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * The upstream call a request makes on its own behalf.
 *
 * It carries four things the gateway is entitled to see on every call: the
 * caller's `Authorization` when there is one, the correlation id, and the
 * request identity — tracking id, client IP, device. The identity is read from
 * the request rather than passed in, so no service can forget it and no caller
 * can forge it by setting a header.
 *
 * A cacheable read should use `gatewayFetch` instead. The identity here is
 * telemetry and security context, not a content dimension: if the gateway
 * varies its answer by any of it, that answer cannot go into shared HTML.
 */
export function gatewayFetchForRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<GatewayResponse> {
  const headers = new Headers(init.headers);
  const authorization = request.headers.get("authorization");
  const requestId = request.headers.get("x-request-id") ?? activeRequestId();
  if (authorization) headers.set("authorization", authorization);
  if (requestId && !headers.has("correlationid")) headers.set("correlationid", requestId);
  applyGatewayIdentity(headers, readGatewayIdentity(request));
  return gatewayFetch(path, { ...init, headers, signal: init.signal ?? request.signal });
}

/**
 * The identity without the caller's credentials.
 *
 * For a call whose result is shared — a public list, a menu — where the gateway
 * still wants to know which visitor and which device asked. Never carries
 * `Authorization`, so nothing personal can come back and land in cached HTML.
 */
export function gatewayFetchWithIdentity(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<GatewayResponse> {
  const headers = new Headers(init.headers);
  const requestId = request.headers.get("x-request-id") ?? activeRequestId();
  if (requestId && !headers.has("correlationid")) headers.set("correlationid", requestId);
  applyGatewayIdentity(headers, readGatewayIdentity(request));
  return gatewayFetch(path, { ...init, headers, signal: init.signal ?? request.signal });
}
