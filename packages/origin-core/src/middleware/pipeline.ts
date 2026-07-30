import { applyCookies, mergeResponseHeaders } from "./cookie-jar.js";
import { shouldRunPipeline } from "./matcher.js";
import { compileMiddleware, type OriginMiddleware } from "./product.js";
import { createInitialResult, runSequential } from "./sequential.js";
import { authStep } from "./steps/auth/index.js";
import { redirectionStep } from "./steps/redirection/index.js";
import { sessionStep } from "./steps/session/index.js";
import type { MiddlewareStep, PipelineResult } from "./types.js";

/** The platform's own steps. Product middleware brackets them, never replaces them. */
const pipelineSteps: MiddlewareStep[] = [authStep, sessionStep, redirectionStep];

export type Pipeline = (
  request: Request,
  requestId: string | undefined,
  clientIp: string,
  preparedUrl?: URL,
) => Promise<PipelineResult>;

/**
 * Build the document pipeline for one app:
 *
 *   before-auth middleware → auth → session → CMS redirect → before-render middleware → SSR
 */
export function createPipeline(middleware: readonly OriginMiddleware[] = []): Pipeline {
  const { beforeAuth, beforeRender } = compileMiddleware(middleware);
  const steps = [...beforeAuth, ...pipelineSteps, ...beforeRender];
  return (request, requestId, clientIp, preparedUrl) =>
    runPipeline(steps, request, requestId, clientIp, preparedUrl);
}

async function runPipeline(
  steps: MiddlewareStep[],
  request: Request,
  requestId: string | undefined,
  clientIp: string,
  preparedUrl?: URL,
): Promise<PipelineResult> {
  const url = preparedUrl ?? new URL(request.url);
  const ctx = {
    url,
    pathname: url.pathname,
    publicPath: url.pathname,
    clientIp,
    ...(requestId !== undefined ? { requestId } : {}),
  };

  const acc = createInitialResult(request);
  return runSequential(steps, ctx, acc);
}

export function shouldUsePipeline(pathname: string): boolean {
  return shouldRunPipeline(pathname);
}

/** Apply accumulated cookies/headers to a terminal or SSR response. */
export function finalizePipelineResponse(result: PipelineResult): Response {
  if (result.response) {
    let res = mergeResponseHeaders(result.response, result.responseHeaders);
    res = applyCookies(res, result.cookies);
    return res;
  }
  throw new Error("finalizePipelineResponse requires terminal response");
}

export function finalizeSsrResponse(ssrResponse: Response, result: PipelineResult): Response {
  let res = mergeResponseHeaders(ssrResponse, result.responseHeaders);
  res = applyCookies(res, result.cookies);
  return res;
}

export { pipelineSteps };
