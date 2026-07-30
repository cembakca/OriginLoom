import { CookieJar } from "./cookie-jar.js";
import type { MiddlewareStep, PipelineContext, PipelineResult } from "./types.js";

function mergeAcc(current: PipelineResult, patch: Partial<PipelineResult>): PipelineResult {
  if (patch.cookies) current.cookies.merge(patch.cookies);
  if (patch.responseHeaders) {
    patch.responseHeaders.forEach((v, k) => current.responseHeaders.set(k, v));
  }
  if (patch.request) current.request = patch.request;
  if (patch.trackingId) current.trackingId = patch.trackingId;
  if (patch.values) current.values = { ...current.values, ...patch.values };
  if (patch.cacheVary) {
    // Union, never intersection: once a value is declared to change the rendered
    // HTML, a later step may not quietly un-declare it and share the cache entry.
    current.cacheVary = [...new Set([...(current.cacheVary ?? []), ...patch.cacheVary])];
  }
  if (patch.response) current.response = patch.response;
  return current;
}

/** Run pipeline steps left-to-right. Stops on terminal response. */
export async function runSequential(
  steps: MiddlewareStep[],
  ctx: PipelineContext,
  acc: PipelineResult,
): Promise<PipelineResult> {
  let current = acc;

  for (const step of steps) {
    const patch = await step(ctx, current);
    if (!patch) continue;

    current = mergeAcc({ ...current, cookies: current.cookies }, patch);

    if (current.response) break;
  }

  return current;
}

export function createInitialResult(request: Request): PipelineResult {
  return {
    request,
    cookies: new CookieJar(),
    responseHeaders: new Headers(),
  };
}

export function cloneRequestWithHeaders(request: Request, headers: Headers): Request {
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    redirect: request.redirect,
    signal: request.signal,
    // @ts-expect-error — duplex for streaming body
    duplex: request.body ? "half" : undefined,
  });
}
