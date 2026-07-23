import { resolve } from "node:path";

import { defineConfig } from "vite";

import { createClientViteConfig } from "@originloom/react/vite";

export default defineConfig(
  createClientViteConfig({
    entry: resolve(__dirname, "src/entry.client.tsx"),
    alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") },
    reload: {
      shouldReload: (file) =>
        file.includes("/server/") ||
        file.includes("/src/features/") ||
        file.includes("/src/components/") ||
        file.endsWith("/src/lib/island.tsx"),
    },
  }),
);
