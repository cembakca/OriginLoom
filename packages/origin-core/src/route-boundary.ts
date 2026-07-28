import type { Ctx, Route, RouteError } from "@originloom/shared/lib/types";

import type { Assets } from "./assets.js";
import { renderDocumentView } from "./document.js";
import { getRuntime } from "./runtime.js";

export async function renderNotFoundDocument(
  assets: Assets,
  routeCtx: Ctx,
  route?: Route,
): Promise<string> {
  const runtime = getRuntime();
  const doc = runtime.document;
  return renderDocumentView({
    assets,
    routeCtx,
    content: runtime.renderer.notFoundContent(routeCtx, route),
    metadata: doc.boundaryMetadata("not-found", routeCtx),
    pageMeta: doc.defaultPageMeta(routeCtx, "not-found"),
    ...(route?.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
  });
}

export async function renderRouteErrorDocument(
  assets: Assets,
  routeCtx: Ctx,
  route: Route,
  error: RouteError | null,
  status: number,
): Promise<string> {
  const runtime = getRuntime();
  const doc = runtime.document;
  return renderDocumentView({
    assets,
    routeCtx,
    content: runtime.renderer.errorContent(routeCtx, route, error, status),
    metadata: doc.boundaryMetadata("route-error", routeCtx),
    pageMeta: doc.defaultPageMeta(routeCtx, "route-error"),
    ...(route.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
  });
}
