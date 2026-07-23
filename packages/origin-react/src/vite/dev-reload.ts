import type { Plugin, ViteDevServer } from "vite";

export type DevReloadOptions = {
  /** Decides whether a changed file needs a full document reload (SSR output changed). */
  shouldReload: (file: string) => boolean;
  /** Health endpoint polled before triggering the reload. */
  healthUrl?: string;
  debounceMs?: number;
};

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
