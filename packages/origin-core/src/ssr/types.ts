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

export type RouteExecution = {
  result: LoaderResult<unknown>;
  body?: string;
  streamResult?: StreamResult;
  /** Preserves a render failure reference until the error boundary is rendered. */
  errorId?: string;
  /** Shares public shell work with document render and fresh fragment stitching. */
  shellResolution?: ShellResolution;
};
