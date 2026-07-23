import type { Ctx } from "../types";
import type { PageMetadata, SiteMetadataConfig } from "./types";

export type SiteMetadataOptions = {
  /** Static site identity (name, title template, OG defaults, icons). */
  site: (baseUrl: string) => SiteMetadataConfig;
  /**
   * Metadata used when a route declares neither `generateMetadata` nor `title`.
   * Defaults to a minimal path-derived title.
   */
  fallbackPageMetadata?: (path: string, ctx: Ctx) => PageMetadata;
};

let options: SiteMetadataOptions | null = null;

/** Install the app's site identity once at startup (composition root / test setup). */
export function configureSiteMetadata(next: SiteMetadataOptions): void {
  options = next;
}

export function siteMetadataConfig(baseUrl: string): SiteMetadataConfig {
  if (!options) {
    throw new Error(
      "Site metadata is not configured — call configureSiteMetadata() before rendering",
    );
  }
  return options.site(baseUrl);
}

export function fallbackPageMetadata(path: string, ctx: Ctx): PageMetadata | undefined {
  return options?.fallbackPageMetadata?.(path, ctx);
}
