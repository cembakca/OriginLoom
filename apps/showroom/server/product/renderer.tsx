import { MetadataHead } from "@originloom/react/lib/metadata/metadata-head";
import { createReactRenderer } from "@originloom/react/server";
import { productConfig } from "@server/product/config";

import { GtmBootstrap } from "~/components/analytics/gtm-bootstrap";
import { HeadClient } from "~/components/head/head-client";
import { RootLayout } from "~/components/layout/root-layout";
import type { ShellData } from "~/lib/shell-data";

import { NotFoundPage, RouteErrorPage } from "./boundary-pages";

/** The product's document chrome — the React half of the runtime contract. */
export const productRenderer = createReactRenderer<ShellData>({
  NotFoundComponent: NotFoundPage,
  ErrorComponent: RouteErrorPage,
  renderHeadStart: ({ seo, cspNonce }) => (
    <>
      <MetadataHead meta={seo} nonce={cspNonce} />
      <HeadClient />
    </>
  ),
  renderHeadEnd: ({ cspNonce, isBot }) => (
    <GtmBootstrap containerId={productConfig.gtmContainerId} isBot={isBot} nonce={cspNonce} />
  ),
  renderLayout: ({ shell, pageMeta, children }) => (
    <RootLayout shell={shell} pageMeta={pageMeta}>
      {children}
    </RootLayout>
  ),
});
