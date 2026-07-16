import { assetCdnOrigin } from "@server/assets";
import { buildShellData } from "@server/services/shell-data";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { GtmBootstrap, isBotRequest } from "~/components/analytics/gtm-bootstrap";
import { HeadClient } from "~/components/head/head-client";
import { MetadataHead } from "~/components/head/metadata-head";
import { RootLayout } from "~/components/layout/root-layout";
import type { PageAnalyticsMeta } from "~/lib/analytics/types";
import { resolveDocumentMetadata } from "~/lib/metadata/resolve";
import type { ResolvedMetadata } from "~/lib/metadata/types";
import { defaultPageMeta } from "~/lib/shell-data";
import { stripUndefined } from "~/lib/strip-undefined";
import type { Ctx, Route } from "~/lib/types";

import { config } from "./config";

export type Assets = { js: string; css: string[] };

export type DocumentContext = {
  routeCtx: Ctx;
};

export async function renderDocument<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
): Promise<string> {
  const { routeCtx } = docCtx;
  const seo = resolveDocumentMetadata(route, data, routeCtx);
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));

  return renderDocumentView({
    assets,
    routeCtx,
    content: <route.Component data={data} />,
    metadata: seo,
    pageMeta,
    ...stripUndefined({ minimalChrome: route.minimalChrome }),
  });
}

export async function renderDocumentView({
  assets,
  routeCtx,
  content,
  metadata,
  pageMeta,
  minimalChrome,
}: {
  assets: Assets;
  routeCtx: Ctx;
  content: ReactElement;
  metadata: ResolvedMetadata;
  pageMeta: PageAnalyticsMeta;
  minimalChrome?: boolean;
}): Promise<string> {
  const isBot = isBotRequest(routeCtx.request);
  const shell = await buildShellData(routeCtx, stripUndefined({ minimalChrome }));
  const seo = metadata;

  const cdnOrigin = assetCdnOrigin();

  const html = renderToString(
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <MetadataHead meta={seo} />
        <HeadClient />
        {cdnOrigin ? <link rel="preconnect" href={cdnOrigin} crossOrigin="anonymous" /> : null}
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <link rel="modulepreload" href={assets.js} />
        <GtmBootstrap containerId={config.gtmContainerId} isBot={isBot} />
      </head>
      <body>
        <div id="root">
          <RootLayout shell={shell} pageMeta={pageMeta}>
            {content}
          </RootLayout>
        </div>
        <script type="module" src={assets.js} />
      </body>
    </html>,
  );
  return "<!DOCTYPE html>" + html;
}
