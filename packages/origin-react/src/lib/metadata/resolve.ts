import type { Ctx, Route } from "../types";
import { metadataFromTitle } from "./generate";
import { mergeMetadata } from "./merge";
import { fallbackPageMetadata } from "./site-config";
import type { PageMetadata, ResolvedMetadata } from "./types";

/** Resolve final <head> SEO from site defaults + route generateMetadata. */
export function resolveDocumentMetadata<T>(route: Route<T>, data: T, ctx: Ctx): ResolvedMetadata {
  const page = resolvePageMetadata(route, data, ctx);
  return mergeMetadata(page, ctx);
}

function resolvePageMetadata<T>(route: Route<T>, data: T, ctx: Ctx): PageMetadata | undefined {
  if (route.generateMetadata) return route.generateMetadata(data, ctx);

  if (route.title) return metadataFromTitle(route.title(data), ctx);

  return fallbackPageMetadata(route.path, ctx) ?? metadataFromTitle(route.path, ctx);
}
