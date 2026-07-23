import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "./config";
import { type FontAsset, readFontAssets } from "./media";

export type Assets = {
  js: string;
  css: string[];
  fonts: FontAsset[];
  modulePreloads?: string[];
  islandModulePreloads?: Record<string, string[]>;
  development?: { client: string; reactRefresh: string };
};

export type ManifestChunk = {
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  src?: string;
  file: string;
  css?: string[];
  imports?: string[];
};

export type ViteManifest = Record<string, ManifestChunk>;

export type AssetsOptions = {
  /** Vite dev-server module path of the client entry. */
  clientEntry?: string;
  /** Dev-only blocking stylesheets injected into <head>. */
  devStylesheets?: string[];
  /** Client build manifest location (relative to the process cwd). */
  manifestPath?: string;
  /** Source prefix that marks island chunks in the manifest. */
  islandSourcePrefix?: string;
  /** Islands preloaded on every page (module-preload graph joins the entry). */
  eagerIslands?: readonly string[];
};

export type ManifestPreloadOptions = {
  islandSourcePrefix?: string;
  eagerIslands?: readonly string[];
};

const DEFAULT_CLIENT_ENTRY = "/src/entry.client.tsx";
const DEFAULT_DEV_STYLESHEETS = ["/src/styles/globals.css"];

const DEFAULT_ISLAND_SOURCE_PREFIX = "src/islands/";

/** Mantıksal asset path → CDN veya origin URL. */
export function assetUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = config.assetCdnUrl?.replace(/\/$/, "");
  return base ? `${base}${normalized}` : normalized;
}

export function readAssets(options: AssetsOptions = {}): Assets {
  const clientEntry = options.clientEntry ?? DEFAULT_CLIENT_ENTRY;
  const devStylesheets = options.devStylesheets ?? DEFAULT_DEV_STYLESHEETS;
  const manifestPath = options.manifestPath ?? join(config.clientDistDir, ".vite/manifest.json");

  if (config.viteDevServerUrl) {
    const viteOrigin = config.viteDevServerUrl.replace(/\/$/, "");
    return {
      js: `${viteOrigin}${clientEntry}`,
      // Head'de blocking stylesheet — full reload'da FOUC/layout shift olmasın.
      // entry.client.tsx import'u HMR için kalır.
      css: devStylesheets.map((path) => `${viteOrigin}${path}`),
      fonts: readFontAssets(),
      development: {
        client: `${viteOrigin}/@vite/client`,
        reactRefresh: `${viteOrigin}/@react-refresh`,
      },
    };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ViteManifest;
  const resolved = resolveManifestPreloads(manifest, {
    ...(options.islandSourcePrefix !== undefined
      ? { islandSourcePrefix: options.islandSourcePrefix }
      : {}),
    ...(options.eagerIslands !== undefined ? { eagerIslands: options.eagerIslands } : {}),
  });

  return {
    js: assetUrl(`/${resolved.entry.file}`),
    css: (resolved.entry.css ?? []).map((file) => assetUrl(`/${file}`)),
    fonts: readFontAssets(),
    modulePreloads: resolved.modulePreloadFiles.map((file) => assetUrl(`/${file}`)),
    islandModulePreloads: Object.fromEntries(
      Object.entries(resolved.islandModulePreloadFiles).map(([name, files]) => [
        name,
        files.map((file) => assetUrl(`/${file}`)),
      ]),
    ),
  };
}

export function resolveManifestPreloads(
  manifest: ViteManifest,
  options: ManifestPreloadOptions = {},
): {
  entry: ManifestChunk;
  modulePreloadFiles: string[];
  islandModulePreloadFiles: Record<string, string[]>;
} {
  const islandSourcePrefix = options.islandSourcePrefix ?? DEFAULT_ISLAND_SOURCE_PREFIX;
  const eagerIslands = options.eagerIslands ?? [];
  const entryRecord = Object.entries(manifest).find(([, chunk]) => chunk.isEntry);
  if (!entryRecord) throw new Error("Vite manifest entry not found — run npm run build first");
  const [entryKey, entry] = entryRecord;
  const islandModulePreloadFiles = buildIslandModulePreloadFiles(manifest, islandSourcePrefix);
  const globalModuleKeys = [
    entryKey,
    ...eagerIslands.map((name) => islandManifestKey(manifest, name, islandSourcePrefix)),
  ];
  return {
    entry,
    modulePreloadFiles: collectManifestFiles(manifest, globalModuleKeys),
    islandModulePreloadFiles,
  };
}

export function collectManifestFiles(manifest: ViteManifest, entryKeys: string[]): string[] {
  const visited = new Set<string>();
  const files: string[] = [];

  const visit = (key: string): void => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Vite manifest chunk not found: ${key}`);
    files.push(chunk.file);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  };

  for (const key of entryKeys) visit(key);
  return files;
}

function buildIslandModulePreloadFiles(
  manifest: ViteManifest,
  islandSourcePrefix: string,
): Record<string, string[]> {
  const islands: Record<string, string[]> = {};
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.isDynamicEntry || !chunk.src?.startsWith(islandSourcePrefix)) continue;
    const name = chunk.src.slice(islandSourcePrefix.length).replace(/\.tsx?$/, "");
    islands[name] = collectManifestFiles(manifest, [key]);
  }
  return islands;
}

function islandManifestKey(
  manifest: ViteManifest,
  name: string,
  islandSourcePrefix: string,
): string {
  const source = `${islandSourcePrefix}${name}.tsx`;
  const record = Object.entries(manifest).find(
    ([key, chunk]) => key === source || chunk.src === source,
  );
  if (!record) throw new Error(`Eager island not found in Vite manifest: ${name}`);
  return record[0];
}

/** CDN origin — preconnect için (ör. https://cdn.hangikredi.com). */
export function assetCdnOrigin(): string | null {
  if (!config.assetCdnUrl) return null;
  try {
    return new URL(config.assetCdnUrl).origin;
  } catch {
    return null;
  }
}
