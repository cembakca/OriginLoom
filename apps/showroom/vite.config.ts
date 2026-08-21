import { resolve } from "node:path";

import { createClientViteConfig } from "@originloom/react/vite";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig(
  createClientViteConfig({
    entry: resolve(root, "src/entry.client.tsx"),
    alias: { "~": resolve(root, "src"), "@server": resolve(root, "server") },
    reload: {},
  }),
);
