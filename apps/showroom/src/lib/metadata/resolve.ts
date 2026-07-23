import type { PageMetadata, ResolvedMetadata } from "@originloom/react/lib/metadata/types";
import type { Ctx, Route } from "@originloom/react/lib/types";

import { generateMetaDataForPageWithDummySeoInfo, metadataFromTitle } from "./generate";
import { mergeMetadata } from "./merge";

/** Resolve final <head> SEO from site defaults + route generateMetadata. */
export function resolveDocumentMetadata<T>(route: Route<T>, data: T, ctx: Ctx): ResolvedMetadata {
  const page = resolvePageMetadata(route, data, ctx);
  return mergeMetadata(page, ctx);
}

function resolvePageMetadata<T>(route: Route<T>, data: T, ctx: Ctx): PageMetadata | undefined {
  if (route.generateMetadata) return route.generateMetadata(data, ctx);

  if (route.title) return metadataFromTitle(route.title(data), ctx);

  return generateMetaDataForPageWithDummySeoInfo(route.path, ctx);
}
