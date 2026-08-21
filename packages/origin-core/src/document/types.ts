import type { Ctx } from "@originloom/shared/lib/types";

import type { ShellResolution } from "../shell-resolution.js";

export type DocumentContext = {
  routeCtx: Ctx;
  shellResolution?: ShellResolution;
  includeRequestOverlay?: boolean;
};

export type { StreamResult } from "@originloom/shared/render";
