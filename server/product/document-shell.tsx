import { config } from "@server/config";
import type { DocumentShell } from "@server/runtime";

import { GtmBootstrap, isBotRequest } from "~/components/analytics/gtm-bootstrap";
import { HeadClient } from "~/components/head/head-client";
import { MetadataHead } from "~/components/head/metadata-head";
import { RootLayout } from "~/components/layout/root-layout";
import { mergeMetadata } from "~/lib/metadata/merge";
import { resolveDocumentMetadata } from "~/lib/metadata/resolve";
import type { ResolvedMetadata } from "~/lib/metadata/types";
import { defaultPageMeta, type ShellData } from "~/lib/shell-data";
import type { Ctx, Route } from "~/lib/types";

import { NotFoundPage, RouteErrorPage } from "./boundary-pages";

export const productDocumentShell: DocumentShell<ShellData> = {
  htmlLang: "tr",
  errorPageTitle: "Sayfa gösterilemiyor | Hangikredi",
  isBotRequest,
  resolveMetadata: <T,>(route: Route<T>, data: T, ctx: Ctx) =>
    withSiteVerification(resolveDocumentMetadata(route, data, ctx)),
  boundaryMetadata: (kind, ctx) =>
    kind === "not-found"
      ? mergeMetadata(
          {
            title: "Sayfa bulunamadı",
            description: "Aradığınız sayfa bulunamadı.",
            robots: { index: false, follow: false },
          },
          ctx,
        )
      : mergeMetadata(
          {
            title: "Sayfa gösterilemiyor",
            description: "Bu sayfa şu anda gösterilemiyor.",
            robots: { index: false, follow: false },
          },
          ctx,
        ),
  defaultPageMeta: (ctx, pageType) => defaultPageMeta(ctx, pageType),
  NotFoundComponent: NotFoundPage,
  ErrorComponent: RouteErrorPage,
  renderHeadStart: ({ seo, cspNonce }) => (
    <>
      <MetadataHead meta={seo} nonce={cspNonce} />
      <HeadClient />
    </>
  ),
  renderHeadEnd: ({ cspNonce, isBot }) => (
    <GtmBootstrap containerId={config.gtmContainerId} isBot={isBot} nonce={cspNonce} />
  ),
  renderLayout: ({ shell, pageMeta, children }) => (
    <RootLayout shell={shell} pageMeta={pageMeta}>
      {children}
    </RootLayout>
  ),
};

function withSiteVerification(metadata: ResolvedMetadata): ResolvedMetadata {
  return {
    ...metadata,
    verification: {
      ...metadata.verification,
      ...(config.googleSiteVerification
        ? { "google-site-verification": config.googleSiteVerification }
        : {}),
      ...(config.bingSiteVerification ? { "msvalidate.01": config.bingSiteVerification } : {}),
      ...(config.yandexSiteVerification
        ? { "yandex-verification": config.yandexSiteVerification }
        : {}),
    },
  };
}
