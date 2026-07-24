import { assetCdnOrigin, type Assets } from "../assets.js";
import { imageCdnOrigins } from "../media.js";

export type DocumentHeadAssets = {
  preconnectOrigins: string[];
  modulePreloads: string[];
};

export function resolveDocumentHeadAssets(
  assets: Assets,
  preloadIslands: readonly string[],
): DocumentHeadAssets {
  const cdnOrigin = assetCdnOrigin();
  const viteOrigin = assets.development ? new URL(assets.development.client).origin : null;
  const preconnectOrigins = [
    ...new Set([cdnOrigin, viteOrigin, ...imageCdnOrigins()].filter(Boolean)),
  ] as string[];

  return {
    preconnectOrigins,
    modulePreloads: assets.development ? [] : resolveModulePreloads(assets, preloadIslands),
  };
}

function resolveModulePreloads(assets: Assets, preloadIslands: readonly string[]): string[] {
  const preloads = new Set(assets.modulePreloads ?? [assets.js]);
  for (const island of preloadIslands) {
    const islandPreloads = assets.islandModulePreloads?.[island];
    if (!islandPreloads) {
      throw new Error(`Route preload island not found in Vite manifest: ${island}`);
    }
    for (const href of islandPreloads) preloads.add(href);
  }
  return [...preloads];
}
