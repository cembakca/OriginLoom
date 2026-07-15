import { applyCookies, mergeResponseHeaders } from "./cookie-jar";
import { shouldRunPipeline } from "./matcher";
import { createInitialResult, runSequential } from "./sequential";
import { authStep } from "./steps/auth";
import { redirectionStep } from "./steps/redirection";
import { sessionStep } from "./steps/session";
import type { MiddlewareStep, PipelineResult } from "./types";

const pipelineSteps: MiddlewareStep[] = [authStep, sessionStep, redirectionStep];

export async function runPipeline(request: Request, requestId?: string): Promise<PipelineResult> {
  const url = new URL(request.url);
  const ctx = {
    url,
    pathname: url.pathname,
    publicPath: url.pathname,
    ...(requestId !== undefined ? { requestId } : {}),
  };

  const acc = createInitialResult(request);
  return runSequential(pipelineSteps, ctx, acc);
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
