import { resolve } from "node:path";

import { createServerViteConfig } from "@originloom/react/vite";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig(
  createServerViteConfig({
    entry: resolve(root, "server/index.ts"),
    alias: { "~": resolve(root, "src"), "@server": resolve(root, "server") },
    // Fully self-contained server bundle: the production container ships dist/ only.
    noExternal: true,
  }),
);
