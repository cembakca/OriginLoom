import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ImagePreload } from "@originloom/shared/lib/media";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import type { Ctx, Route } from "@originloom/shared/lib/types";
import type { DocumentRenderInput, FrameworkNode, StreamResult } from "@originloom/shared/render";

import type { Assets } from "./assets.js";
import { resolveDocumentHeadAssets } from "./document/head-assets.js";
import type { DocumentContext } from "./document/types.js";
import { getRuntime } from "./runtime.js";

export type { DocumentContext, StreamResult } from "./document/types.js";

/** What a caller decides; everything else is resolved from the runtime. */
export type DocumentView = {
  assets: Assets;
  routeCtx: Ctx;
  content: FrameworkNode;
  metadata: ResolvedMetadata;
  pageMeta: PageAnalyticsMeta;
  imagePreloads?: readonly ImagePreload[];
  preloadIslands?: readonly string[];
  minimalChrome?: boolean;
  cspNonce?: string | undefined;
};

export async function renderDocument<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
): Promise<string> {
  const input = await buildDocumentInput(routeDocumentView(route, data, assets, docCtx.routeCtx));
  return getRuntime().renderer.renderDocument(input);
}

export async function renderDocumentView(view: DocumentView): Promise<string> {
  return getRuntime().renderer.renderDocument(await buildDocumentInput(view));
}

export async function renderDocumentToStream<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
  onError: (error: unknown) => void,
): Promise<StreamResult> {
  const input = await buildDocumentInput(routeDocumentView(route, data, assets, docCtx.routeCtx));
  return getRuntime().renderer.renderDocumentToStream(input, { onError });
}

/** The view a route renders: its content plus the route-level head hints. */
function routeDocumentView<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  routeCtx: Ctx,
): DocumentView {
  const runtime = getRuntime();
  const doc = runtime.document;
  return {
    assets,
    routeCtx,
    content: runtime.renderer.routeContent(route, data, routeCtx),
    metadata: doc.resolveMetadata(route, data, routeCtx),
    pageMeta:
      route.pageMeta?.(data, routeCtx) ??
      doc.defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, "")),
    imagePreloads: route.preloadImages?.(data, routeCtx) ?? [],
    ...stripUndefined({
      preloadIslands: route.preloadIslands,
      minimalChrome: route.minimalChrome,
    }),
    cspNonce: routeCtx.cspNonce,
  };
}

async function buildDocumentInput({
  assets,
  routeCtx,
  content,
  metadata,
  pageMeta,
  imagePreloads = [],
  preloadIslands = [],
  minimalChrome,
  cspNonce = routeCtx.cspNonce,
}: DocumentView): Promise<DocumentRenderInput> {
  const runtime = getRuntime();
  const shell = await runtime.buildShellData(routeCtx, stripUndefined({ minimalChrome }));
  const { preconnectOrigins, modulePreloads } = resolveDocumentHeadAssets(assets, preloadIslands);

  return {
    htmlLang: runtime.document.htmlLang,
    assets,
    seo: metadata,
    pageMeta,
    shell,
    content,
    isBot: runtime.document.isBotRequest(routeCtx.request),
    preconnectOrigins,
    imagePreloads,
    modulePreloads,
    cspNonce,
  };
}

export async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}
