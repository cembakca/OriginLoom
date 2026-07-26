/** @jsxRuntime automatic */ /** @jsxImportSource react */
import type { Ctx, Route, RouteError } from "@originloom/shared/lib/types";
import type { ComponentType } from "react";

import type { Assets } from "./assets.js";
import { renderDocumentView } from "./document.js";
import { getRuntime } from "./runtime.js";

export async function renderNotFoundDocument(
  assets: Assets,
  routeCtx: Ctx,
  route?: Route,
): Promise<string> {
  const doc = getRuntime().document;
  // Route-supplied boundaries return the neutral node type; React needs them
  // narrowed. Temporary — this pick moves into the renderer adapter.
  const Component = (route?.NotFoundComponent ?? doc.NotFoundComponent) as ComponentType;
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
  const Component = (route.ErrorComponent ?? doc.ErrorComponent) as ComponentType<{
    error: RouteError | null;
    status: number;
  }>;
  return renderDocumentView({
    assets,
    routeCtx,
    content: <Component error={error} status={status} />,
    metadata: doc.boundaryMetadata("route-error", routeCtx),
    pageMeta: doc.defaultPageMeta(routeCtx, "route-error"),
    ...(route.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
  });
}
