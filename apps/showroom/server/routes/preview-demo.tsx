import { isPreviewRequest } from "@originloom/core/preview";
import { defineRoute } from "@originloom/react/lib/types";

import { PreviewDemoPage } from "~/features/preview/preview-demo-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/dummy-seo";
import { defaultPageMeta } from "~/lib/shell-data";

/** Stands in for a CMS with one published and one unpublished revision. */
const PUBLISHED = {
  title: "Konut kredisi faizleri düştü",
  body: "Bu, yayındaki içerik. Herkes bunu görür ve paylaşılan cache'ten gelir.",
};
const DRAFT = {
  title: "TASLAK: Konut kredisi faizleri için yeni kampanya",
  body: "Bu revizyon henüz yayınlanmadı. Yalnızca preview oturumundaki editör görür.",
};

/**
 * The page is declared `shared` — and in a preview session it is not cached at
 * all.
 *
 * The route does not arrange that: `previewCachePolicy` in the platform
 * downgrades the policy before a cache key can exist, so the read, the write
 * and the background revalidation all stop together. That is deliberate. If
 * bypassing were the route's job, one route would eventually forget and
 * unpublished content would be served to everyone from shared storage until the
 * entry expired.
 */
export default defineRoute({
  path: "/preview-demo",
  cache: pageCache(PageCacheId.previewDemo),
  loader: async (ctx) => {
    const preview = isPreviewRequest(ctx.request);
    return { data: { preview, revision: preview ? DRAFT : PUBLISHED } };
  },
  generateMetadata: (_data, ctx) => ({
    ...generateMetaDataForPageWithDummySeoInfo("/preview-demo", ctx),
    robots: { index: false, follow: false },
  }),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "preview-demo", { category: "demo" }),
  Component: ({ data }) => <PreviewDemoPage {...data} />,
});
