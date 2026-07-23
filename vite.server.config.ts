import { resolve } from "node:path";

import { defineConfig } from "vite";

import { createServerViteConfig } from "@originloom/react/vite";

export default defineConfig(
  createServerViteConfig({
    entry: resolve(__dirname, "server/index.ts"),
    alias: { "~": resolve(__dirname, "src"), "@server": resolve(__dirname, "server") },
  }),
);
