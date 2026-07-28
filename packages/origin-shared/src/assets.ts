/**
 * Asset descriptors the server resolves once per build and hands to the renderer.
 * The shapes live here because both the core (which reads them off disk) and the
 * renderer adapter (which turns them into head markup) need them.
 */
export type FontAsset = {
  family: string;
  style: string;
  weight: string;
  display: "swap" | "optional" | "fallback";
  unicodeRange: string;
  preload: boolean;
  href: string;
};

export type Assets = {
  js: string;
  css: string[];
  fonts: FontAsset[];
  modulePreloads?: string[];
  islandModulePreloads?: Record<string, string[]>;
  /** Dev-server URLs. Adapters derive their own tooling URLs from `client`. */
  development?: { client: string };
};
