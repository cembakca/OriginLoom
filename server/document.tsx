import { PassThrough, Readable } from "node:stream";

import type { Assets } from "@server/assets";
import { getRuntime } from "@server/runtime";
import type { ReactElement } from "react";
import { renderToPipeableStream, renderToString } from "react-dom/server";

import type { PageAnalyticsMeta } from "~/lib/analytics/types";
import type { ImagePreload } from "~/lib/media";
import type { ResolvedMetadata } from "~/lib/metadata/types";
import { stripUndefined } from "~/lib/strip-undefined";
import type { Ctx, Route } from "~/lib/types";

import { resolveDocumentHeadAssets } from "./document/head-assets";
import { DocumentLayout } from "./document/layout";
import type { DocumentContext, StreamResult } from "./document/types";

export type { DocumentContext, StreamResult } from "./document/types";

export async function renderDocument<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
): Promise<string> {
  const { routeCtx } = docCtx;
  const doc = getRuntime().document;
  const seo = doc.resolveMetadata(route, data, routeCtx);
  const imagePreloads = route.preloadImages?.(data, routeCtx) ?? [];
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    doc.defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));

  return renderDocumentView({
    assets,
    routeCtx,
    content: <route.Component data={data} />,
    metadata: seo,
    pageMeta,
    imagePreloads,
    ...stripUndefined({ cspNonce: routeCtx.cspNonce }),
    ...stripUndefined({
      preloadIslands: route.preloadIslands,
      minimalChrome: route.minimalChrome,
    }),
  });
}

export async function renderDocumentView({
  assets,
  routeCtx,
  content,
  metadata,
  pageMeta,
  imagePreloads = [],
  preloadIslands = [],
  minimalChrome,
  cspNonce = routeCtx.cspNonce,
}: {
  assets: Assets;
  routeCtx: Ctx;
  content: ReactElement;
  metadata: ResolvedMetadata;
  pageMeta: PageAnalyticsMeta;
  imagePreloads?: ImagePreload[];
  preloadIslands?: readonly string[];
  minimalChrome?: boolean;
  cspNonce?: string;
}): Promise<string> {
  const runtime = getRuntime();
  const isBot = runtime.document.isBotRequest(routeCtx.request);
  const shell = await runtime.buildShellData(routeCtx, stripUndefined({ minimalChrome }));
  const seo = metadata;

  const { preconnectOrigins, modulePreloads } = resolveDocumentHeadAssets(assets, preloadIslands);

  const html = renderToString(
    <DocumentLayout
      seo={seo}
      assets={assets}
      preconnectOrigins={preconnectOrigins}
      imagePreloads={imagePreloads}
      modulePreloads={modulePreloads}
      isBot={isBot}
      shell={shell}
      pageMeta={pageMeta}
      content={content}
      cspNonce={cspNonce}
    />,
  );
  return "<!DOCTYPE html>" + html;
}

export async function renderDocumentToStream<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
  onError: (error: unknown) => void,
): Promise<StreamResult> {
  const { routeCtx } = docCtx;
  const runtime = getRuntime();
  const doc = runtime.document;
  const seo = doc.resolveMetadata(route, data, routeCtx);
  const imagePreloads = route.preloadImages?.(data, routeCtx) ?? [];
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    doc.defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));
  const preloadIslands = route.preloadIslands ?? [];
  const isBot = doc.isBotRequest(routeCtx.request);
  const shell = await runtime.buildShellData(
    routeCtx,
    stripUndefined({ minimalChrome: route.minimalChrome }),
  );

  const { preconnectOrigins, modulePreloads } = resolveDocumentHeadAssets(assets, preloadIslands);

  const passThrough = new PassThrough();
  passThrough.write("<!DOCTYPE html>");

  let shellReadyResolve: () => void;
  let shellReadyReject: (err: unknown) => void;
  const shellReadyPromise = new Promise<void>((resolve, reject) => {
    shellReadyResolve = resolve;
    shellReadyReject = reject;
  });

  let allReadyResolve: () => void;
  const allReadyPromise = new Promise<void>((resolve) => {
    allReadyResolve = resolve;
  });

  const content = <route.Component data={data} />;

  const rxStream = renderToPipeableStream(
    <DocumentLayout
      seo={seo}
      assets={assets}
      preconnectOrigins={preconnectOrigins}
      imagePreloads={imagePreloads}
      modulePreloads={modulePreloads}
      isBot={isBot}
      shell={shell}
      pageMeta={pageMeta}
      content={content}
      cspNonce={routeCtx.cspNonce}
    />,
    {
      onShellReady() {
        rxStream.pipe(passThrough);
        shellReadyResolve();
      },
      onAllReady() {
        allReadyResolve();
      },
      onShellError(error) {
        passThrough.destroy(error as Error);
        shellReadyReject(error);
      },
      onError(error) {
        onError(error);
      },
      ...stripUndefined({ nonce: routeCtx.cspNonce }),
    },
  );

  await shellReadyPromise;

  return {
    stream: Readable.toWeb(passThrough) as unknown as ReadableStream<Uint8Array>,
    abort: () => rxStream.abort(),
    allReady: allReadyPromise,
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
