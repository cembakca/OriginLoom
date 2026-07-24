import type { LoaderResult } from "@originloom/react/lib/types";

import type { StreamResult } from "../document.js";

export type HandleContext = {
  requestId?: string;
  trackingId?: string;
  clientIp?: string;
  cspNonce?: string;
};

export type RenderPhase = "request" | "revalidation" | "cache_fill";

export type RouteExecution = {
  result: LoaderResult<unknown>;
  body?: string;
  streamResult?: StreamResult;
};
