import type { Ctx, Route, RouteError } from "@originloom/shared/lib/types";

import type { Assets } from "./assets.js";
import { renderDocumentView } from "./document.js";
import { getRuntime } from "./runtime.js";
import { resolveTerminalShell } from "./shell-resolution.js";

export async function renderNotFoundDocument(
  assets: Assets,
  routeCtx: Ctx,
  route?: Route,
): Promise<string> {
  const runtime = getRuntime();
  const doc = runtime.document;
  const options = route?.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {};
  const resolvedShell = await resolveTerminalShell(routeCtx, route?.path ?? "not-found", options);
  return renderDocumentView({
    assets,
    routeCtx,
    content: runtime.renderer.notFoundContent(routeCtx, route),
    metadata: doc.boundaryMetadata("not-found", routeCtx),
    pageMeta: doc.defaultPageMeta(routeCtx, "not-found"),
    ...(route?.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
    resolvedShell,
  });
}

export async function renderRouteErrorDocument(
  assets: Assets,
  routeCtx: Ctx,
  route: Route,
  error: RouteError | null,
  status: number,
  errorId: string,
): Promise<string> {
  const runtime = getRuntime();
  const doc = runtime.document;
  const options = route.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {};
  const resolvedShell = await resolveTerminalShell(routeCtx, route.path, options);
  return renderDocumentView({
    assets,
    routeCtx,
    content: runtime.renderer.errorContent(routeCtx, route, error, status, errorId),
    metadata: doc.boundaryMetadata("route-error", routeCtx),
    pageMeta: doc.defaultPageMeta(routeCtx, "route-error"),
    ...(route.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
    resolvedShell,
  });
}
