import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, UserConfig, ViteDevServer } from "vite";

export type DevReloadOptions = {
  /** Decides whether a changed file needs a full document reload (SSR output changed). */
  shouldReload: (file: string) => boolean;
  /** Health endpoint polled before triggering the reload. */
  healthUrl?: string;
  debounceMs?: number;
};

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

/**
 * Full-reloads the browser after the SSR server restarts: waits until the health
 * endpoint responds, so the reload lands on the new process instead of the gap.
 */
export function createDevReloadPlugin(options: DevReloadOptions): Plugin {
  const debounceMs = options.debounceMs ?? 600;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    name: "origin-loom-server-reload",
    apply: "serve",
    configureServer(server) {
      const onChange = (file: string) => {
        if (!options.shouldReload(file.replaceAll("\\", "/"))) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void reloadWhenReady(server, options.healthUrl), debounceMs);
      };
      server.watcher.on("change", onChange);
      server.httpServer?.once("close", () => {
        if (timer) clearTimeout(timer);
        server.watcher.off("change", onChange);
      });
    },
  };
}

async function reloadWhenReady(server: ViteDevServer, healthUrl?: string): Promise<void> {
  const url = healthUrl ?? `${process.env.SITE_URL ?? "http://127.0.0.1:3005"}/healthz`;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        server.ws.send({ type: "full-reload" });
        return;
      }
    } catch {
      // The SSR server is between the old and new process; retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.config.logger.warn("SSR server did not become ready; browser reload was skipped");
}
