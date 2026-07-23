import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite";

// Explicit extension: the Vite config loader hands this module to Node's native
// TS type-stripping, which requires fully-specified relative imports.
import { createDevReloadPlugin, type DevReloadOptions } from "./dev-reload.ts";

export type ClientViteConfigOptions = {
  /** Absolute path of the client entry module. */
  entry: string;
  /** Path aliases (e.g. { "~": <src>, "@server": <server> }). */
  alias?: Record<string, string>;
  outDir?: string;
  devServer?: { host?: string; port?: number };
  /** Omit to disable the SSR full-reload plugin. */
  reload?: DevReloadOptions;
};

export type ServerViteConfigOptions = {
  /** Absolute path of the SSR server entry module. */
  entry: string;
  alias?: Record<string, string>;
  outDir?: string;
  /**
   * true bundles every dependency into the output (fully self-contained
   * server, container needs no node_modules). Defaults to inlining only
   * the workspace packages.
   */
  noExternal?: true | Array<string | RegExp>;
};

/** Client island bundle. The server is plain Node — it never goes through Vite. */
export function createClientViteConfig(options: ClientViteConfigOptions): UserConfig {
  const port = options.devServer?.port ?? 5174;
  const host = options.devServer?.host ?? "127.0.0.1";
  return {
    appType: "custom",
    plugins: [
      react(),
      tailwindcss(),
      ...(options.reload ? [createDevReloadPlugin(options.reload)] : []),
    ],
    resolve: { alias: options.alias ?? {}, dedupe: ["react", "react-dom"] },
    // Workspace packages ship TypeScript source; keep them out of the dep optimizer.
    optimizeDeps: { exclude: ["@originloom/react", "@originloom/core"] },
    server: {
      host,
      port,
      strictPort: true,
      origin: process.env.VITE_DEV_SERVER_URL ?? `http://${host}:${port}`,
      cors: { origin: /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/ },
    },
    build: {
      manifest: true,
      outDir: options.outDir ?? "dist/client",
      rollupOptions: {
        input: options.entry,
      },
    },
  };
}

/** SSR server bundle: single self-contained index.js consumed by plain Node. */
export function createServerViteConfig(options: ServerViteConfigOptions): UserConfig {
  return {
    resolve: { alias: options.alias ?? {}, dedupe: ["react", "react-dom"] },
    // Inline workspace package source into the bundle — Node cannot import the raw .ts exports.
    ssr: { noExternal: options.noExternal ?? [/^@originloom\//] },
    build: {
      ssr: options.entry,
      outDir: options.outDir ?? "dist/server",
      emptyOutDir: false,
      sourcemap: true,
      rollupOptions: {
        output: { entryFileNames: "index.js" },
      },
    },
  };
}
