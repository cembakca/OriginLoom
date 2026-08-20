import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(root, "src"),
      "@server": resolve(root, "server"),
    },
  },
  test: {
    name: "showroom",
    globalSetup: ["./tests/global-setup.mjs"],
    setupFiles: ["./tests/setup-runtime.ts"],
    server: {
      // Process workspace package source through the test runner so vi.mock
      // substitutions (e.g. ioredis) reach @originloom/* internals.
      deps: { inline: [/@originloom\//] },
    },
  },
});
