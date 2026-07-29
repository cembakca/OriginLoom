import {
  Agent,
  type Dispatcher,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici";

import { config } from "./config.js";

let dispatcher: Agent | null = null;
const originalGlobalFetch = globalThis.fetch;
const isTestRuntime = process.env.NODE_ENV === "test";

/**
 * One dispatcher per process. Undici keeps connections alive and applies the
 * configured connection bound independently to each origin. Normal gateway
 * traffic uses one origin; external proxy rewrites must include every target
 * origin when calculating the pod's total upstream socket budget.
 */
export function gatewayDispatcher(): Dispatcher {
  dispatcher ??= new Agent({
    connections: config.gatewayMaxConnections,
    pipelining: config.gatewayPipelining,
    connect: {
      timeout: config.gatewayConnectTimeoutMs,
      autoSelectFamily: true,
    },
    headersTimeout: config.gatewayHeadersTimeoutMs,
    bodyTimeout: config.gatewayBodyTimeoutMs,
    keepAliveTimeout: config.gatewayKeepAliveTimeoutMs,
    keepAliveMaxTimeout: config.gatewayKeepAliveTimeoutMs,
  });
  return dispatcher;
}

/** Uses one Undici version for both fetch and dispatcher; mixed majors are ABI-incompatible. */
export function gatewayTransportFetch(url: URL, init: RequestInit): Promise<Response> {
  const request = {
    ...init,
    dispatcher: gatewayDispatcher(),
  } as UndiciRequestInit;
  // Existing unit tests replace global fetch with a bounded in-memory stub. The
  // production path always uses Undici's matching fetch/dispatcher pair.
  if (isTestRuntime && globalThis.fetch !== originalGlobalFetch) {
    return globalThis.fetch(url, request as RequestInit);
  }
  return undiciFetch(url, request) as unknown as Promise<Response>;
}

/** Gracefully drains queued gateway requests before process shutdown. */
export async function closeGatewayTransport(): Promise<void> {
  const current = dispatcher;
  dispatcher = null;
  if (current) await current.close();
}
