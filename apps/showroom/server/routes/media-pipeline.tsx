import { config } from "@originloom/core/config";
import { responsiveImage, unoptimizedImage } from "@originloom/core/media";
import { imagePreload } from "@originloom/react/lib/media";
import { defineRoute } from "@originloom/react/lib/types";

import {
  MEDIA_DEMO_SIZES,
  type MediaPipelineData,
  MediaPipelinePage,
} from "~/features/media-pipeline/page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { generateMetaDataForPageWithSeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<MediaPipelineData>({
  path: "/medya-pipeline",
  cache: (ctx) => pageCachePolicy(PageCacheId.mediaPipeline, ctx),
  loader: async () => ({
    data: {
      responsive: responsiveImage("home-hero"),
      unoptimized: unoptimizedImage("home-hero"),
      imageCdnEnabled: Boolean(config.imageCdnUrl),
      transformEnabled: Boolean(config.imageTransformUrl),
    },
  }),
  generateMetadata: (_data, ctx) =>
    generateMetaDataForPageWithSeoInfo(
      {
        title: "Image ve Font Pipeline Demosu",
        metaDescription: "Responsive image ve self-host font pipeline teknik demosu.",
        friendlyUrl: "/medya-pipeline",
        noindex: true,
      },
      ctx,
    ),
  pageMeta: (_data, ctx) =>
    defaultPageMeta(ctx, "media-pipeline", { category: "engineering-demo" }),
  preloadImages: (data) => [imagePreload(data.responsive, MEDIA_DEMO_SIZES)],
  Component: MediaPipelinePage,
});
