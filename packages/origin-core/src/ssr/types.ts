import type { LoaderResult } from "@originloom/shared/lib/types";

import type { StreamResult } from "../document.js";
import type { PreparedRequest } from "../middleware/prepared-request.js";
import type { ShellResolution } from "../shell-resolution.js";

export type HandleContext = {
  requestId?: string;
  trackingId?: string;
  clientIp?: string;
  cspNonce?: string;
  preparedRequest?: PreparedRequest;
  /** Values published by product middleware for this request. */
  values?: Record<string, string>;
  /** Which of those values fragment the shared HTML cache key. */
  cacheVary?: readonly string[];
};

export type RenderPhase = "request" | "revalidation" | "cache_fill";

/** Sequential server-side phases of one execution, in milliseconds. */
export type RouteTimings = {
  loaderMs: number;
  renderMs: number;
};

export type RouteExecution = {
  result: LoaderResult<unknown>;
  body?: string;
  streamResult?: StreamResult;
  /** Preserves a render failure reference until the error boundary is rendered. */
  errorId?: string;
  /** Shares public shell work with document render and fresh fragment stitching. */
  shellResolution?: ShellResolution;
  /** Absent when the loader short-circuited before anything was rendered. */
  timings?: RouteTimings;
  /** Present only when a form action ran: what it wants the response to say. */
  submission?: { status?: number; headers?: Record<string, string> };
};
