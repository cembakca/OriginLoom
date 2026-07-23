import type { Ctx, Route, RouteError } from "@originloom/react/lib/types";

import type { Assets } from "./assets";
import { renderDocumentView } from "./document";
import { getRuntime } from "./runtime";

export async function renderNotFoundDocument(
  assets: Assets,
  routeCtx: Ctx,
  route?: Route,
): Promise<string> {
  const doc = getRuntime().document;
  const Component = route?.NotFoundComponent ?? doc.NotFoundComponent;
  return renderDocumentView({
    assets,
    routeCtx,
    content: <Component />,
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
  const doc = getRuntime().document;
  const Component = route.ErrorComponent ?? doc.ErrorComponent;
  return renderDocumentView({
    assets,
    routeCtx,
    content: <Component error={error} status={status} />,
    metadata: doc.boundaryMetadata("route-error", routeCtx),
    pageMeta: doc.defaultPageMeta(routeCtx, "route-error"),
    ...(route.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
  });
}
