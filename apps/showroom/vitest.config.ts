import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
      "@server": resolve(__dirname, "server"),
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
