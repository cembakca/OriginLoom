import {
  findSsrFragmentMarkers,
  type SsrFragmentMarker,
  ssrFragmentPlaceholder,
} from "@originloom/shared/fragment-markup";
import type { Ctx, Route } from "@originloom/shared/lib/types";

import { logError } from "../logger.js";
import { getRuntime } from "../runtime.js";
import { rethrowRequestDeadline } from "../ssr/context.js";
import {
  fragmentRequiresShell,
  getOrSetFragmentByName,
  shouldResolveFragment,
} from "./fragment.js";

export async function stitchCachedHtml(
  htmlContent: string,
  route: Route,
  routeCtx: Ctx,
  cachedDocument: boolean,
  compiledMarkers?: readonly SsrFragmentMarker[],
): Promise<string> {
  if (route.minimalChrome) return htmlContent;
  if (!htmlContent.includes("<ssr-fragment ")) return htmlContent;

  const markers = (compiledMarkers ?? findSsrFragmentMarkers(htmlContent)).filter((marker) =>
    shouldResolveFragment(marker.name, cachedDocument),
  );
  if (markers.length === 0) return htmlContent;

  try {
    const runtime = getRuntime();
    const needsShell = markers.some((marker) => fragmentRequiresShell(marker.name));
    const shell = needsShell ? await runtime.buildShellData(routeCtx) : null;
    if (needsShell && (shell == null || !runtime.isShellUsableForFragments(shell))) {
      return htmlContent;
    }

    const names = [...new Set(markers.map((marker) => marker.name))];
    const resolvedHtmls = await Promise.all(
      names.map(async (name): Promise<[string, string | undefined]> => {
        try {
          return [name, await getOrSetFragmentByName(name, shell, routeCtx)];
        } catch (error) {
          rethrowRequestDeadline(routeCtx.request, error);
          logError(error, {
            msg: "Failed to resolve cached HTML fragment",
            fragment: name,
            path: routeCtx.url.pathname,
          });
          return [name, undefined];
        }
      }),
    );
    const htmlMap = new Map(resolvedHtmls);

    return stitchByOffsets(htmlContent, markers, htmlMap);
  } catch (error) {
    rethrowRequestDeadline(routeCtx.request, error);
    logError(error, {
      msg: "Failed to stitch cached HTML fragments",
      path: routeCtx.url.pathname,
    });
    return htmlContent;
  }
}

function stitchByOffsets(
  html: string,
  markers: readonly SsrFragmentMarker[],
  resolved: ReadonlyMap<string, string | undefined>,
): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (const marker of markers) {
    chunks.push(html.slice(cursor, marker.start));
    const freshHtml = resolved.get(marker.name);
    chunks.push(
      freshHtml === undefined
        ? html.slice(marker.start, marker.end)
        : ssrFragmentPlaceholder(marker.name, freshHtml),
    );
    cursor = marker.end;
  }
  chunks.push(html.slice(cursor));
  return chunks.join("");
}
