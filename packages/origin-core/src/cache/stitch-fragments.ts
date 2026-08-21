import {
  findSsrFragmentMarkers,
  type SsrFragmentMarker,
  ssrFragmentPlaceholder,
} from "@originloom/shared/fragment-markup";
import type { Ctx, Route } from "@originloom/shared/lib/types";

import { logError } from "../logger.js";
import { getRuntime } from "../runtime.js";
import { createShellResolution, type ShellResolution } from "../shell-resolution.js";
import { rethrowRequestDeadline } from "../ssr/context.js";
import {
  fragmentFallbackByName,
  resolveFragmentByName,
  shouldResolveFragment,
} from "./fragment.js";

export async function stitchCachedHtml(
  htmlContent: string,
  route: Route,
  routeCtx: Ctx,
  cachedDocument: boolean,
  compiledMarkers?: readonly SsrFragmentMarker[],
  shellResolution?: ShellResolution,
): Promise<string> {
  if (route.minimalChrome) return htmlContent;
  if (!htmlContent.includes("<ssr-fragment ")) return htmlContent;

  const markers = (compiledMarkers ?? findSsrFragmentMarkers(htmlContent)).filter((marker) =>
    shouldResolveFragment(marker.name, cachedDocument),
  );
  if (markers.length === 0) return htmlContent;

  try {
    const runtime = getRuntime();
    let foregroundShell: Promise<unknown> | undefined;
    let refreshShell: Promise<unknown> | undefined;
    const getShell = () => {
      foregroundShell ??= resolveUsableShell(
        shellResolution ?? createShellResolution(routeCtx, route.path),
        runtime.isShellUsableForFragments,
      );
      return foregroundShell;
    };
    const getRefreshShell = () => {
      refreshShell ??= resolveUsableShell(
        createShellResolution(detachedContext(routeCtx), route.path),
        runtime.isShellUsableForFragments,
      );
      return refreshShell;
    };

    const names = [...new Set(markers.map((marker) => marker.name))];
    const resolvedHtmls = await Promise.all(
      names.map(async (name): Promise<[string, string | undefined]> => {
        try {
          return [
            name,
            await resolveFragmentByName(name, routeCtx, {
              getShell,
              getFillShell: cachedDocument ? getRefreshShell : getShell,
              getRefreshShell,
            }),
          ];
        } catch (error) {
          rethrowRequestDeadline(routeCtx.request, error);
          logError(error, {
            msg: "Failed to resolve cached HTML fragment",
            fragment: name,
            path: routeCtx.url.pathname,
          });
          try {
            return [name, await fragmentFallbackByName(name, error, routeCtx)];
          } catch (fallbackError) {
            logError(fallbackError, {
              msg: "Failed to render cached HTML fragment fallback",
              fragment: name,
              path: routeCtx.url.pathname,
            });
            return [name, undefined];
          }
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

async function resolveUsableShell(
  resolution: ShellResolution,
  isUsable: (shell: unknown) => boolean,
): Promise<unknown> {
  const shell = await resolution.resolve({ includeRequestOverlay: false });
  if (shell == null || !isUsable(shell)) throw new Error("Shell is unavailable for fragments");
  return shell;
}

function detachedContext(ctx: Ctx): Ctx {
  return {
    ...ctx,
    request: new Request(ctx.request, { signal: new AbortController().signal }),
  };
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
