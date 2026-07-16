import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
      "@server": resolve(__dirname, "server"),
    },
  },
  build: {
    ssr: resolve(__dirname, "server/index.ts"),
    outDir: "dist/server",
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      output: { entryFileNames: "index.js" },
    },
  },
});
