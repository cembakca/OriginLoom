import { config } from "@server/config";
import { responsiveImage, unoptimizedImage } from "@server/media";

import {
  MEDIA_DEMO_SIZES,
  type MediaPipelineData,
  MediaPipelinePage,
} from "~/features/media-pipeline/page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { imagePreload } from "~/lib/media";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";

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
  generateMetadata: (_data, ctx) => generateMetaDataForPageWithDummySeoInfo("/medya-pipeline", ctx),
  pageMeta: (_data, ctx) =>
    defaultPageMeta(ctx, "media-pipeline", { category: "engineering-demo" }),
  preloadImages: (data) => [imagePreload(data.responsive, MEDIA_DEMO_SIZES)],
  Component: MediaPipelinePage,
});
