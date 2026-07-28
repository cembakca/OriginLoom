import type { DocumentShell } from "@originloom/core/runtime";
import { mergeMetadata } from "@originloom/shared/lib/metadata/merge";
import { resolveDocumentMetadata } from "@originloom/shared/lib/metadata/resolve";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import type { Ctx, Route } from "@originloom/shared/lib/types";
import { productConfig } from "@server/product/config";

import { isBotRequest } from "~/components/analytics/gtm-bootstrap";
import { defaultPageMeta } from "~/lib/shell-data";

/** Framework-free document policy. The views live in `./renderer`. */
export const productDocumentShell: DocumentShell = {
  htmlLang: "tr",
  errorPageTitle: "Sayfa gösterilemiyor | Hangikredi",
  isBotRequest,
  resolveMetadata: <T>(route: Route<T>, data: T, ctx: Ctx) =>
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
};

function withSiteVerification(metadata: ResolvedMetadata): ResolvedMetadata {
  return {
    ...metadata,
    verification: {
      ...metadata.verification,
      ...(productConfig.googleSiteVerification
        ? { "google-site-verification": productConfig.googleSiteVerification }
        : {}),
      ...(productConfig.bingSiteVerification
        ? { "msvalidate.01": productConfig.bingSiteVerification }
        : {}),
      ...(productConfig.yandexSiteVerification
        ? { "yandex-verification": productConfig.yandexSiteVerification }
        : {}),
    },
  };
}
