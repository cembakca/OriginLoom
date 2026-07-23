import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

// Builds ONLY the client island bundle. The server is plain Node — it never
// goes through Vite. Server rendering uses react-dom/server directly.
export default defineConfig({
  appType: "custom",
  plugins: [react(), tailwindcss(), reloadAfterServerRestart()],
  resolve: { alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") } },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    origin: process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174",
    cors: { origin: /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/ },
  },
  build: {
    manifest: true,
    outDir: "dist/client",
    rollupOptions: {
      input: resolve(__dirname, "src/entry.client.tsx"),
    },
  },
});

function reloadAfterServerRestart(): Plugin {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    name: "origin-loom-server-reload",
    apply: "serve",
    configureServer(server) {
      const onChange = (file: string) => {
        if (!requiresDocumentReload(file)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void reloadWhenReady(server), 600);
      };
      server.watcher.on("change", onChange);
      server.httpServer?.once("close", () => {
        if (timer) clearTimeout(timer);
        server.watcher.off("change", onChange);
      });
    },
  };
}

function requiresDocumentReload(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  return (
    normalized.includes("/server/") ||
    normalized.includes("/src/features/") ||
    normalized.includes("/src/components/") ||
    normalized.endsWith("/src/lib/island.tsx")
  );
}

async function reloadWhenReady(server: ViteDevServer): Promise<void> {
  const healthUrl = `${process.env.SITE_URL ?? "http://127.0.0.1:3005"}/healthz`;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      if (response.ok) {
        server.ws.send({ type: "full-reload" });
        return;
      }
    } catch {
      // tsx is between the old and new server process; retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.config.logger.warn("Hono did not become ready; browser reload was skipped");
}
