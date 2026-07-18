import { PassThrough, Readable } from "node:stream";
import { assetCdnOrigin } from "@server/assets";
import { buildShellData } from "@server/services/shell-data";
import type { ReactElement } from "react";
import { renderToString, renderToPipeableStream } from "react-dom/server";

import { GtmBootstrap, isBotRequest } from "~/components/analytics/gtm-bootstrap";
import { HeadClient } from "~/components/head/head-client";
import { MetadataHead } from "~/components/head/metadata-head";
import { RootLayout } from "~/components/layout/root-layout";
import type { PageAnalyticsMeta } from "~/lib/analytics/types";
import type { ImagePreload } from "~/lib/media";
import { resolveDocumentMetadata } from "~/lib/metadata/resolve";
import type { ResolvedMetadata } from "~/lib/metadata/types";
import { defaultPageMeta } from "~/lib/shell-data";
import { stripUndefined } from "~/lib/strip-undefined";
import type { Ctx, Route } from "~/lib/types";

import { config } from "./config";
import { type FontAsset, imageCdnOrigins } from "./media";

export type Assets = {
  js: string;
  css: string[];
  fonts: FontAsset[];
  modulePreloads?: string[];
  islandModulePreloads?: Record<string, string[]>;
  development?: { client: string; reactRefresh: string };
};

export type DocumentContext = {
  routeCtx: Ctx;
};

export type StreamResult = {
  stream: ReadableStream;
  abort: () => void;
  allReady: Promise<void>;
};

type DocumentLayoutProps = {
  seo: ResolvedMetadata;
  assets: Assets;
  preconnectOrigins: string[];
  imagePreloads: ImagePreload[];
  modulePreloads: string[];
  isBot: boolean;
  shell: any;
  pageMeta: PageAnalyticsMeta;
  content: ReactElement;
};

function DocumentLayout({
  seo,
  assets,
  preconnectOrigins,
  imagePreloads,
  modulePreloads,
  isBot,
  shell,
  pageMeta,
  content,
}: DocumentLayoutProps) {
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <MetadataHead meta={seo} />
        <HeadClient />
        {assets.fonts.map((font) =>
          font.preload ? (
            <link
              key={`preload-${font.href}`}
              rel="preload"
              as="font"
              type="font/woff2"
              href={font.href}
              crossOrigin="anonymous"
            />
          ) : null,
        )}
        {imagePreloads.map((preload) => (
          <link
            key={`${preload.type}-${preload.href}`}
            rel="preload"
            as="image"
            href={preload.href}
            type={preload.type}
            imageSrcSet={preload.imageSrcSet}
            imageSizes={preload.imageSizes}
            fetchPriority="high"
          />
        ))}
        {assets.fonts.length > 0 ? <style>{fontFaceCss(assets.fonts)}</style> : null}
        {preconnectOrigins.map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {assets.development ? (
          <>
            <script type="module" src={assets.development.client} />
            <script
              type="module"
              dangerouslySetInnerHTML={{
                __html: reactRefreshPreamble(assets.development.reactRefresh),
              }}
            />
          </>
        ) : null}
        {modulePreloads.map((href) => (
          <link key={href} rel="modulepreload" href={href} />
        ))}
        <GtmBootstrap containerId={config.gtmContainerId} isBot={isBot} />
      </head>
      <body>
        <div id="root">
          <RootLayout shell={shell} pageMeta={pageMeta}>
            {content}
          </RootLayout>
        </div>
        <script
          type="module"
          src={assets.js}
          crossOrigin={assets.development ? "anonymous" : undefined}
        />
      </body>
    </html>
  );
}

export async function renderDocument<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
): Promise<string> {
  const { routeCtx } = docCtx;
  const seo = resolveDocumentMetadata(route, data, routeCtx);
  const imagePreloads = route.preloadImages?.(data, routeCtx) ?? [];
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));

  return renderDocumentView({
    assets,
    routeCtx,
    content: <route.Component data={data} />,
    metadata: seo,
    pageMeta,
    imagePreloads,
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
}: {
  assets: Assets;
  routeCtx: Ctx;
  content: ReactElement;
  metadata: ResolvedMetadata;
  pageMeta: PageAnalyticsMeta;
  imagePreloads?: ImagePreload[];
  preloadIslands?: readonly string[];
  minimalChrome?: boolean;
}): Promise<string> {
  const isBot = isBotRequest(routeCtx.request);
  const shell = await buildShellData(routeCtx, stripUndefined({ minimalChrome }));
  const seo = metadata;

  const cdnOrigin = assetCdnOrigin();
  const viteOrigin = assets.development ? new URL(assets.development.client).origin : null;
  const preconnectOrigins = [
    ...new Set([cdnOrigin, viteOrigin, ...imageCdnOrigins()].filter(Boolean)),
  ] as string[];
  const modulePreloads = assets.development ? [] : resolveModulePreloads(assets, preloadIslands);

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
  const seo = resolveDocumentMetadata(route, data, routeCtx);
  const imagePreloads = route.preloadImages?.(data, routeCtx) ?? [];
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));
  const preloadIslands = route.preloadIslands ?? [];
  const isBot = isBotRequest(routeCtx.request);
  const shell = await buildShellData(
    routeCtx,
    stripUndefined({ minimalChrome: route.minimalChrome }),
  );

  const cdnOrigin = assetCdnOrigin();
  const viteOrigin = assets.development ? new URL(assets.development.client).origin : null;
  const preconnectOrigins = [
    ...new Set([cdnOrigin, viteOrigin, ...imageCdnOrigins()].filter(Boolean)),
  ] as string[];
  const modulePreloads = assets.development ? [] : resolveModulePreloads(assets, preloadIslands);

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
    },
  );

  await shellReadyPromise;

  return {
    stream: Readable.toWeb(passThrough) as any,
    abort: () => rxStream.abort(),
    allReady: allReadyPromise,
  };
}

export async function streamToString(stream: ReadableStream): Promise<string> {
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

function resolveModulePreloads(assets: Assets, preloadIslands: readonly string[]): string[] {
  const preloads = new Set(assets.modulePreloads ?? [assets.js]);
  for (const island of preloadIslands) {
    const islandPreloads = assets.islandModulePreloads?.[island];
    if (!islandPreloads) {
      throw new Error(`Route preload island not found in Vite manifest: ${island}`);
    }
    for (const href of islandPreloads) preloads.add(href);
  }
  return [...preloads];
}

function reactRefreshPreamble(refreshRuntimeUrl: string): string {
  const url = JSON.stringify(refreshRuntimeUrl).replaceAll("<", "\\u003c");
  return `import RefreshRuntime from ${url};
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;`;
}

function fontFaceCss(fonts: FontAsset[]): string {
  return fonts
    .map(
      (font) =>
        `@font-face{font-family:${cssString(font.family)};src:url(${cssString(
          font.href,
        )}) format("woff2");font-style:${font.style};font-weight:${font.weight};font-display:${
          font.display
        };unicode-range:${font.unicodeRange}}`,
    )
    .join("");
}

function cssString(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\3c ");
}
