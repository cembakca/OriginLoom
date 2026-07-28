import { SSR_FRAGMENT_PATTERN, ssrFragmentPlaceholder } from "@originloom/shared/fragment-markup";
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
): Promise<string> {
  if (route.minimalChrome) return htmlContent;

  const matches = [...htmlContent.matchAll(SSR_FRAGMENT_PATTERN)].filter((match) =>
    shouldResolveFragment(match[1]!, cachedDocument),
  );
  if (matches.length === 0) return htmlContent;

  try {
    const runtime = getRuntime();
    const needsShell = matches.some((match) => fragmentRequiresShell(match[1]!));
    const shell = needsShell ? await runtime.buildShellData(routeCtx) : null;
    if (needsShell && (shell == null || !runtime.isShellUsableForFragments(shell))) {
      return htmlContent;
    }

    const names = [...new Set(matches.map((match) => match[1]!))];
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

    return htmlContent.replace(SSR_FRAGMENT_PATTERN, (fullMatch: string, name: string) => {
      const freshHtml = htmlMap.get(name);
      return freshHtml === undefined ? fullMatch : ssrFragmentPlaceholder(name, freshHtml);
    });
  } catch (error) {
    rethrowRequestDeadline(routeCtx.request, error);
    logError(error, {
      msg: "Failed to stitch cached HTML fragments",
      path: routeCtx.url.pathname,
    });
    return htmlContent;
  }
}
