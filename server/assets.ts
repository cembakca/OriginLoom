import { readFileSync } from "node:fs";

import { config } from "./config";
import type { Assets } from "./document";

type ManifestChunk = { isEntry?: boolean; file: string; css?: string[] };

/** Mantıksal asset path → CDN veya origin URL. */
export function assetUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = config.assetCdnUrl?.replace(/\/$/, "");
  return base ? `${base}${normalized}` : normalized;
}

export function readAssets(): Assets {
  if (config.viteDevServerUrl) {
    return {
      js: `${config.viteDevServerUrl}/src/entry.client.tsx`,
      css: [],
      development: {
        client: `${config.viteDevServerUrl}/@vite/client`,
        reactRefresh: `${config.viteDevServerUrl}/@react-refresh`,
      },
    };
  }

  const manifest = JSON.parse(readFileSync("dist/client/.vite/manifest.json", "utf8")) as Record<
    string,
    ManifestChunk
  >;
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("Vite manifest entry not found — run npm run build first");

  return {
    js: assetUrl(`/${entry.file}`),
    css: (entry.css ?? []).map((file) => assetUrl(`/${file}`)),
  };
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
