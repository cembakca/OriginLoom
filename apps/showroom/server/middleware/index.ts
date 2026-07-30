import type { OriginMiddleware } from "@originloom/core/middleware";

import { maintenanceMiddleware } from "./maintenance";
import { redirectRulesMiddleware } from "./redirect-rules";
import { searchIndexingMiddleware } from "./search-indexing";

/**
 * This app's middleware, in the order they run inside their phase.
 *
 * The platform's own steps — auth, session, CMS redirects — are not in this
 * list and cannot be reordered; a middleware only declares whether it belongs
 * before them (`before-auth`) or after them (`before-render`, the default).
 */
export const productMiddleware: readonly OriginMiddleware[] = [
  maintenanceMiddleware,
  redirectRulesMiddleware,
  searchIndexingMiddleware,
];
