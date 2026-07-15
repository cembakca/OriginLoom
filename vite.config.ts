import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Builds ONLY the client island bundle. The server is plain Node — it never
// goes through Vite. Server rendering uses react-dom/server directly.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "~": resolve(__dirname, "src") } },
  build: {
    manifest: true,
    outDir: "dist/client",
    rollupOptions: {
      input: resolve(__dirname, "src/entry.client.tsx"),
    },
  },
});
