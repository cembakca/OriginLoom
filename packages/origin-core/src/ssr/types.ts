import type { LoaderResult } from "@originloom/shared/lib/types";

import type { StreamResult } from "../document.js";
import type { PreparedRequest } from "../middleware/prepared-request.js";

export type HandleContext = {
  requestId?: string;
  trackingId?: string;
  clientIp?: string;
  cspNonce?: string;
  preparedRequest?: PreparedRequest;
};

export type RenderPhase = "request" | "revalidation" | "cache_fill";

export type RouteExecution = {
  result: LoaderResult<unknown>;
  body?: string;
  streamResult?: StreamResult;
};
