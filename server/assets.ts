import { readFileSync } from "node:fs";

import { config } from "./config";
import type { Assets } from "./document";
import { readFontAssets } from "./media";

export type ManifestChunk = {
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  src?: string;
  file: string;
  css?: string[];
  imports?: string[];
};

export type ViteManifest = Record<string, ManifestChunk>;

const GLOBAL_EAGER_ISLANDS = ["layout-client", "page-analytics"] as const;

/** Mantıksal asset path → CDN veya origin URL. */
export function assetUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = config.assetCdnUrl?.replace(/\/$/, "");
  return base ? `${base}${normalized}` : normalized;
}

const DEV_GLOBALS_CSS = "/src/styles/globals.css";

export function readAssets(): Assets {
  if (config.viteDevServerUrl) {
    const viteOrigin = config.viteDevServerUrl.replace(/\/$/, "");
    return {
      js: `${viteOrigin}/src/entry.client.tsx`,
      // Head'de blocking stylesheet — full reload'da FOUC/layout shift olmasın.
      // entry.client.tsx import'u HMR için kalır.
      css: [`${viteOrigin}${DEV_GLOBALS_CSS}`],
      fonts: readFontAssets(),
      development: {
        client: `${viteOrigin}/@vite/client`,
        reactRefresh: `${viteOrigin}/@react-refresh`,
      },
    };
  }

  const manifest = JSON.parse(
    readFileSync("dist/client/.vite/manifest.json", "utf8"),
  ) as ViteManifest;
  const resolved = resolveManifestPreloads(manifest);

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

export function resolveManifestPreloads(manifest: ViteManifest): {
  entry: ManifestChunk;
  modulePreloadFiles: string[];
  islandModulePreloadFiles: Record<string, string[]>;
} {
  const entryRecord = Object.entries(manifest).find(([, chunk]) => chunk.isEntry);
  if (!entryRecord) throw new Error("Vite manifest entry not found — run npm run build first");
  const [entryKey, entry] = entryRecord;
  const islandModulePreloadFiles = buildIslandModulePreloadFiles(manifest);
  const globalModuleKeys = [
    entryKey,
    ...GLOBAL_EAGER_ISLANDS.map((name) => islandManifestKey(manifest, name)),
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

function buildIslandModulePreloadFiles(manifest: ViteManifest): Record<string, string[]> {
  const islands: Record<string, string[]> = {};
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.isDynamicEntry || !chunk.src?.startsWith("src/islands/")) continue;
    const name = chunk.src.slice("src/islands/".length).replace(/\.tsx?$/, "");
    islands[name] = collectManifestFiles(manifest, [key]);
  }
  return islands;
}

function islandManifestKey(manifest: ViteManifest, name: string): string {
  const source = `src/islands/${name}.tsx`;
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
